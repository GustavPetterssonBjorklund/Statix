<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { scaleLinear, scaleTime } from "d3-scale";
	import { curveMonotoneX, line } from "d3-shape";
	import { NavDrawer } from "$lib";
	import { clearAuthToken, getAuthToken, validateAuthToken } from "$lib/auth";
	import { drawerLinks, drawerTitles } from "$lib/config/drawer";
	import { connectLiveNodes } from "$lib/live-nodes";

	type AuthUser = {
		id: string;
		email: string;
		displayName: string | null;
		roles: string[];
	};

	type NodeDto = {
		id: string;
		name: string | null;
		lastSeenAt: string;
		createdAt: string;
		updatedAt: string;
		publishCount?: number;
		lastPublishAt?: string | null;
		latestMetric?: {
			at: string;
			ts: number;
			cpu: number;
			memUsed: number;
			memTotal: number;
			diskUsed: number;
			diskTotal: number;
			netRx: number;
			netTx: number;
		} | null;
	};

	type NodeMetricPoint = {
		at: string;
		ts: number;
		cpu: number;
		memUsed: number;
		memTotal: number;
		diskUsed: number;
		diskTotal: number;
		netRx: number;
		netTx: number;
	};

	let nodes: NodeDto[] = [];
	let isLoading = true;
	let errorMessage = "";
	let currentUser: AuthUser | null = null;
	let selectedNodeId = "";
	let selectedNodeHistory: NodeMetricPoint[] = [];
	const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
	const CHART_WIDTH = 760;
	const CHART_HEIGHT = 220;

	function toMillis(value?: string | null) {
		if (!value) {
			return null;
		}

		const ms = Date.parse(value);
		return Number.isNaN(ms) ? null : ms;
	}

	function formatRelative(ms: number | null) {
		if (ms === null) {
			return "n/a";
		}

		const diffSeconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
		if (diffSeconds < 60) {
			return `${diffSeconds}s ago`;
		}
		if (diffSeconds < 3600) {
			return `${Math.floor(diffSeconds / 60)}m ago`;
		}

		return `${Math.floor(diffSeconds / 3600)}h ago`;
	}

	function formatBytes(value: number | undefined) {
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			return "n/a";
		}

		const units = ["B", "KB", "MB", "GB", "TB"];
		let size = value;
		let unitIndex = 0;
		while (size >= 1024 && unitIndex < units.length - 1) {
			size /= 1024;
			unitIndex += 1;
		}

		return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
	}

	function formatPercent(part: number | undefined, total: number | undefined) {
		if (
			typeof part !== "number" ||
			typeof total !== "number" ||
			!Number.isFinite(part) ||
			!Number.isFinite(total) ||
			total <= 0
		) {
			return "n/a";
		}

		return `${((part / total) * 100).toFixed(1)}%`;
	}

	function percentValue(part: number | undefined, total: number | undefined) {
		if (
			typeof part !== "number" ||
			typeof total !== "number" ||
			!Number.isFinite(part) ||
			!Number.isFinite(total) ||
			total <= 0
		) {
			return 0;
		}

		return Math.max(0, Math.min(100, (part / total) * 100));
	}

	type LineChart = {
		path: string;
		xTicks: Array<{ x: number; label: string }>;
		yTicks: Array<{ y: number; label: string }>;
		plotTop: number;
		plotBottom: number;
		plotLeft: number;
		plotRight: number;
	};

	function buildLineChart(values: number[], timestamps: number[], width: number, height: number): LineChart {
		const margin = {
			top: 12,
			right: 10,
			bottom: 34,
			left: 42,
		};
		const plotWidth = Math.max(1, width - margin.left - margin.right);
		const plotHeight = Math.max(1, height - margin.top - margin.bottom);

		if (values.length === 0) {
			return {
				path: "",
				xTicks: [],
				yTicks: [],
				plotTop: margin.top,
				plotBottom: margin.top + plotHeight,
				plotLeft: margin.left,
				plotRight: margin.left + plotWidth,
			};
		}

		let seriesValues = values;
		let seriesTimes = timestamps;
		if (seriesValues.length === 1) {
			seriesValues = [seriesValues[0], seriesValues[0]];
			const t = seriesTimes[0] ?? Date.now();
			seriesTimes = [t - 1000, t];
		}

		const minTime = Math.min(...seriesTimes);
		const maxTime = Math.max(...seriesTimes);
		const paddedMaxTime = maxTime === minTime ? maxTime + 1000 : maxTime;

		const xScale = scaleTime()
			.domain([new Date(minTime), new Date(paddedMaxTime)])
			.range([margin.left, margin.left + plotWidth]);
		const yScale = scaleLinear()
			.domain([Math.min(...seriesValues), Math.max(...seriesValues)])
			.range([margin.top + plotHeight, margin.top])
			.nice();

		const generator = line<number>()
			.x((_: number, index: number) => xScale(new Date(seriesTimes[index] ?? paddedMaxTime)))
			.y((value: number) => yScale(value))
			.curve(curveMonotoneX);

		const yTicks = yScale.ticks(5).map((tick) => ({
			y: yScale(tick),
			label: tick.toFixed(0),
		}));
		const xTicks = xScale.ticks(5).map((tick) => ({
			x: xScale(tick),
			label: tick.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
		}));

		return {
			path: generator(seriesValues) ?? "",
			xTicks,
			yTicks,
			plotTop: margin.top,
			plotBottom: margin.top + plotHeight,
			plotLeft: margin.left,
			plotRight: margin.left + plotWidth,
		};
	}

	function summarizeSeries(values: number[]) {
		if (values.length === 0) {
			return { min: 0, max: 0, avg: 0 };
		}

		const min = Math.min(...values);
		const max = Math.max(...values);
		const avg = values.reduce((total, value) => total + value, 0) / values.length;
		return { min, max, avg };
	}

	function isNodeActive(node: NodeDto) {
		const publishedAt = toMillis(node.lastPublishAt);
		return publishedAt !== null && Date.now() - publishedAt <= ACTIVE_WINDOW_MS;
	}

	$: totalPublishes = nodes.reduce((total, node) => total + (node.publishCount ?? 0), 0);
	$: activeNodes = nodes.filter((node) => {
		const publishedAt = toMillis(node.lastPublishAt);
		return publishedAt !== null && Date.now() - publishedAt <= ACTIVE_WINDOW_MS;
	}).length;
	$: inactiveNodes = Math.max(0, nodes.length - activeNodes);
	$: avgPublishesPerNode = nodes.length > 0 ? Math.round(totalPublishes / nodes.length) : 0;
	$: freshestPublishMs = nodes.reduce<number | null>((latest, node) => {
		const publishedAt = toMillis(node.lastPublishAt);
		if (publishedAt === null) {
			return latest;
		}
		if (latest === null || publishedAt > latest) {
			return publishedAt;
		}
		return latest;
	}, null);
	$: {
		if (nodes.length === 0) {
			selectedNodeId = "";
		} else if (!nodes.some((node) => node.id === selectedNodeId)) {
			selectedNodeId = nodes[0].id;
		}
	}
	$: selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
	$: selectedNodeLastPublishMs = selectedNode ? toMillis(selectedNode.lastPublishAt) : null;
	$: selectedNodeStatus = selectedNode ? (isNodeActive(selectedNode) ? "Active" : "Idle") : "n/a";
	$: cpuSeries = selectedNodeHistory.map((point) => point.cpu * 100);
	$: memSeries = selectedNodeHistory.map((point) => percentValue(point.memUsed, point.memTotal));
	$: diskSeries = selectedNodeHistory.map((point) => percentValue(point.diskUsed, point.diskTotal));
	$: timeSeries = selectedNodeHistory.map((point) => point.ts);
	$: cpuChart = buildLineChart(cpuSeries, timeSeries, CHART_WIDTH, CHART_HEIGHT);
	$: memChart = buildLineChart(memSeries, timeSeries, CHART_WIDTH, CHART_HEIGHT);
	$: diskChart = buildLineChart(diskSeries, timeSeries, CHART_WIDTH, CHART_HEIGHT);
	$: cpuSummary = summarizeSeries(cpuSeries);
	$: memSummary = summarizeSeries(memSeries);
	$: diskSummary = summarizeSeries(diskSeries);

	async function loadSelectedNodeHistory() {
		if (!selectedNodeId) {
			selectedNodeHistory = [];
			return;
		}

		try {
			const response = await fetch(`/api/nodes/${selectedNodeId}/metrics?limit=60`);
			const data = await response.json();
			if (!response.ok) {
				return;
			}
			selectedNodeHistory = Array.isArray(data?.metrics) ? data.metrics : [];
		} catch {
			// keep previous history on transient errors
		}
	}

	onMount(() => {
		let stopLiveNodes = () => {};
		let historyPollTimer: ReturnType<typeof setInterval> | null = null;

		void (async () => {
			const token = getAuthToken();
			if (!token) {
				await goto("/login");
				return;
			}

			const user = await validateAuthToken(token);
			if (!user) {
				clearAuthToken();
				await goto("/login");
				return;
			}
			currentUser = user as AuthUser;

			try {
				const response = await fetch("/api/nodes");
				const data = await response.json();

				if (!response.ok) {
					errorMessage = data?.error ?? "Failed to load nodes";
					return;
				}

				nodes = Array.isArray(data) ? data : [];
			} catch {
				errorMessage = "Unable to load nodes";
			} finally {
				isLoading = false;
			}

			stopLiveNodes = connectLiveNodes<NodeDto>(
				(liveNodes) => {
					nodes = liveNodes;
				},
				(error) => {
					errorMessage = error;
				}
			);

			await loadSelectedNodeHistory();
			historyPollTimer = setInterval(() => {
				void loadSelectedNodeHistory();
			}, 5000);
		})();

		return () => {
			stopLiveNodes();
			if (historyPollTimer) {
				clearInterval(historyPollTimer);
			}
		};
	});

	$: if (selectedNodeId) {
		void loadSelectedNodeHistory();
	}
</script>

<main class="space-y-5 p-6 pl-72">
	<NavDrawer title={drawerTitles.dashboard} links={drawerLinks} />
	<header class="border-b border-zinc-200 bg-white px-2 pb-4 pt-1">
		<p class="text-xs font-medium uppercase tracking-wider text-zinc-500">Statix Dashboard</p>
		<h1 class="mt-2 text-2xl font-bold text-zinc-900">Cluster Overview</h1>
		<p class="mt-1 text-sm text-zinc-600">
			Signed in as {currentUser?.displayName ?? currentUser?.email ?? "user"}
		</p>
	</header>

	<section class="border border-zinc-200 bg-white p-4">
		{#if isLoading}
			<p class="text-zinc-600">Building node statistics...</p>
		{:else if errorMessage}
			<p class="text-red-600">{errorMessage}</p>
		{:else}
			<div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
				<div class="border border-zinc-200 p-3">
					<p class="text-[11px] uppercase tracking-wide text-zinc-500">Nodes</p>
					<p class="mt-1 text-2xl font-semibold text-zinc-900">{nodes.length}</p>
				</div>
				<div class="border border-zinc-200 p-3">
					<p class="text-[11px] uppercase tracking-wide text-zinc-500">Active (2m)</p>
					<p class="mt-1 text-2xl font-semibold text-zinc-900">{activeNodes}</p>
				</div>
				<div class="border border-zinc-200 p-3">
					<p class="text-[11px] uppercase tracking-wide text-zinc-500">Inactive</p>
					<p class="mt-1 text-2xl font-semibold text-zinc-900">{inactiveNodes}</p>
				</div>
				<div class="border border-zinc-200 p-3">
					<p class="text-[11px] uppercase tracking-wide text-zinc-500">Total Publishes</p>
					<p class="mt-1 text-2xl font-semibold text-zinc-900">{totalPublishes}</p>
				</div>
				<div class="border border-zinc-200 p-3">
					<p class="text-[11px] uppercase tracking-wide text-zinc-500">Latest Publish</p>
					<p class="mt-1 text-2xl font-semibold text-zinc-900">{formatRelative(freshestPublishMs)}</p>
				</div>
			</div>
		{/if}
	</section>

	<section class="border border-zinc-200 bg-white p-4">
		<div class="mb-4 grid gap-2">
			<h2 class="text-lg font-semibold text-zinc-900">Selected Node Analytics</h2>
			<p class="text-sm text-zinc-600">Live series and current values for one node.</p>
		</div>
		{#if isLoading}
			<p class="text-zinc-600">Loading node details...</p>
		{:else if errorMessage}
			<p class="text-red-600">{errorMessage}</p>
		{:else if !selectedNode}
			<p class="text-zinc-600">No node selected.</p>
		{:else}
			<div class="mb-4">
				<label class="mb-1 block text-xs font-medium uppercase tracking-wide text-indigo-700" for="node-select">
					Select Node
				</label>
				<select
					id="node-select"
					class="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-zinc-800"
					bind:value={selectedNodeId}
				>
					{#each nodes as node (node.id)}
						<option value={node.id}>{node.name ?? node.id}</option>
					{/each}
				</select>
			</div>

				<div class="grid gap-2 md:grid-cols-4">
					<article class="border border-zinc-200 p-3">
						<p class="text-xs uppercase tracking-wide text-indigo-700">Status</p>
						<p class="mt-1 text-xl font-semibold text-zinc-900">{selectedNodeStatus}</p>
					</article>
					<article class="border border-zinc-200 p-3">
						<p class="text-xs uppercase tracking-wide text-cyan-700">Publishes</p>
						<p class="mt-1 text-xl font-semibold text-zinc-900">{selectedNode.publishCount ?? 0}</p>
					</article>
					<article class="border border-zinc-200 p-3">
						<p class="text-xs uppercase tracking-wide text-amber-700">Last Publish</p>
						<p class="mt-1 text-xl font-semibold text-zinc-900">{formatRelative(selectedNodeLastPublishMs)}</p>
					</article>
					<article class="border border-zinc-200 p-3">
						<p class="text-xs uppercase tracking-wide text-zinc-500">Node ID</p>
						<p class="mt-1 truncate text-sm font-medium text-zinc-900">{selectedNode.id}</p>
					</article>
				</div>

				<div class="mt-2 grid gap-2 md:grid-cols-2">
					<div class="border border-zinc-200 p-3">
						<p class="text-xs uppercase tracking-wide text-zinc-500">Last Seen</p>
						<p class="mt-1 text-sm text-zinc-700">{new Date(selectedNode.lastSeenAt).toLocaleString()}</p>
					</div>
					<div class="border border-zinc-200 p-3">
						<p class="text-xs uppercase tracking-wide text-zinc-500">Created</p>
						<p class="mt-1 text-sm text-zinc-700">{new Date(selectedNode.createdAt).toLocaleString()}</p>
					</div>
				</div>

				<div class="mt-2 border border-zinc-200 p-3">
					<p class="text-xs uppercase tracking-wide text-zinc-500">Latest Reported Metrics</p>
					{#if selectedNode.latestMetric}
					<div class="mt-3 grid gap-3 md:grid-cols-2">
						<p class="text-sm text-zinc-700">
							<span class="font-medium text-zinc-900">CPU:</span>
							{(selectedNode.latestMetric.cpu * 100).toFixed(1)}%
						</p>
						<p class="text-sm text-zinc-700">
							<span class="font-medium text-zinc-900">Memory:</span>
							{formatBytes(selectedNode.latestMetric.memUsed)} / {formatBytes(selectedNode.latestMetric.memTotal)}
							({formatPercent(selectedNode.latestMetric.memUsed, selectedNode.latestMetric.memTotal)})
						</p>
						<p class="text-sm text-zinc-700">
							<span class="font-medium text-zinc-900">Disk:</span>
							{formatBytes(selectedNode.latestMetric.diskUsed)} / {formatBytes(selectedNode.latestMetric.diskTotal)}
							({formatPercent(selectedNode.latestMetric.diskUsed, selectedNode.latestMetric.diskTotal)})
						</p>
						<p class="text-sm text-zinc-700">
							<span class="font-medium text-zinc-900">Network:</span>
							RX {formatBytes(selectedNode.latestMetric.netRx)}, TX {formatBytes(selectedNode.latestMetric.netTx)}
						</p>
						<p class="text-sm text-zinc-700 md:col-span-2">
							<span class="font-medium text-zinc-900">Metric timestamp:</span>
							{new Date(selectedNode.latestMetric.ts).toLocaleString()}
						</p>
					</div>

						{#if selectedNodeHistory.length > 1}
							<div class="mt-4 space-y-3">
								<div class="border border-zinc-200 p-2">
									<div class="grid grid-cols-[1fr_auto] items-center">
										<p class="text-xs uppercase tracking-wide text-zinc-600">CPU %</p>
										<p class="text-xs text-zinc-500">
											min {cpuSummary.min.toFixed(1)} • avg {cpuSummary.avg.toFixed(1)} • max {cpuSummary.max.toFixed(1)}
										</p>
									</div>
									<svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} class="mt-2 h-48 w-full">
										<line x1={cpuChart.plotLeft} y1={cpuChart.plotBottom} x2={cpuChart.plotRight} y2={cpuChart.plotBottom} stroke="#d4d4d8" stroke-width="1" />
										<line x1={cpuChart.plotLeft} y1={cpuChart.plotTop} x2={cpuChart.plotLeft} y2={cpuChart.plotBottom} stroke="#d4d4d8" stroke-width="1" />
										{#each cpuChart.yTicks as tick}
											<line x1={cpuChart.plotLeft} y1={tick.y} x2={cpuChart.plotRight} y2={tick.y} stroke="#f4f4f5" stroke-width="1" />
											<text x={cpuChart.plotLeft - 6} y={tick.y + 3} text-anchor="end" class="fill-zinc-500 text-[9px]">{tick.label}</text>
										{/each}
										{#each cpuChart.xTicks as tick}
											<line x1={tick.x} y1={cpuChart.plotBottom} x2={tick.x} y2={cpuChart.plotBottom + 4} stroke="#d4d4d8" stroke-width="1" />
											<text x={tick.x} y={cpuChart.plotBottom + 14} text-anchor="middle" class="fill-zinc-500 text-[9px]">{tick.label}</text>
										{/each}
										<path d={cpuChart.path} fill="none" stroke="#0891b2" stroke-width="2.5" />
									</svg>
								</div>
								<div class="border border-zinc-200 p-2">
									<div class="grid grid-cols-[1fr_auto] items-center">
										<p class="text-xs uppercase tracking-wide text-zinc-600">Memory %</p>
									<p class="text-xs text-zinc-500">
											min {memSummary.min.toFixed(1)} • avg {memSummary.avg.toFixed(1)} • max {memSummary.max.toFixed(1)}
										</p>
									</div>
									<svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} class="mt-2 h-48 w-full">
										<line x1={memChart.plotLeft} y1={memChart.plotBottom} x2={memChart.plotRight} y2={memChart.plotBottom} stroke="#d4d4d8" stroke-width="1" />
										<line x1={memChart.plotLeft} y1={memChart.plotTop} x2={memChart.plotLeft} y2={memChart.plotBottom} stroke="#d4d4d8" stroke-width="1" />
										{#each memChart.yTicks as tick}
											<line x1={memChart.plotLeft} y1={tick.y} x2={memChart.plotRight} y2={tick.y} stroke="#f4f4f5" stroke-width="1" />
											<text x={memChart.plotLeft - 6} y={tick.y + 3} text-anchor="end" class="fill-zinc-500 text-[9px]">{tick.label}</text>
										{/each}
										{#each memChart.xTicks as tick}
											<line x1={tick.x} y1={memChart.plotBottom} x2={tick.x} y2={memChart.plotBottom + 4} stroke="#d4d4d8" stroke-width="1" />
											<text x={tick.x} y={memChart.plotBottom + 14} text-anchor="middle" class="fill-zinc-500 text-[9px]">{tick.label}</text>
										{/each}
										<path d={memChart.path} fill="none" stroke="#059669" stroke-width="2.5" />
									</svg>
								</div>
								<div class="border border-zinc-200 p-2">
									<div class="grid grid-cols-[1fr_auto] items-center">
										<p class="text-xs uppercase tracking-wide text-zinc-600">Disk %</p>
									<p class="text-xs text-zinc-500">
											min {diskSummary.min.toFixed(1)} • avg {diskSummary.avg.toFixed(1)} • max {diskSummary.max.toFixed(1)}
										</p>
									</div>
									<svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} class="mt-2 h-48 w-full">
										<line x1={diskChart.plotLeft} y1={diskChart.plotBottom} x2={diskChart.plotRight} y2={diskChart.plotBottom} stroke="#d4d4d8" stroke-width="1" />
										<line x1={diskChart.plotLeft} y1={diskChart.plotTop} x2={diskChart.plotLeft} y2={diskChart.plotBottom} stroke="#d4d4d8" stroke-width="1" />
										{#each diskChart.yTicks as tick}
											<line x1={diskChart.plotLeft} y1={tick.y} x2={diskChart.plotRight} y2={tick.y} stroke="#f4f4f5" stroke-width="1" />
											<text x={diskChart.plotLeft - 6} y={tick.y + 3} text-anchor="end" class="fill-zinc-500 text-[9px]">{tick.label}</text>
										{/each}
										{#each diskChart.xTicks as tick}
											<line x1={tick.x} y1={diskChart.plotBottom} x2={tick.x} y2={diskChart.plotBottom + 4} stroke="#d4d4d8" stroke-width="1" />
											<text x={tick.x} y={diskChart.plotBottom + 14} text-anchor="middle" class="fill-zinc-500 text-[9px]">{tick.label}</text>
										{/each}
										<path d={diskChart.path} fill="none" stroke="#d97706" stroke-width="2.5" />
									</svg>
								</div>
							</div>
						{/if}
				{:else}
					<p class="mt-2 text-sm text-zinc-600">No metric sample has been ingested for this node yet.</p>
				{/if}
			</div>
		{/if}
	</section>

	<section class="border border-zinc-200 bg-white p-4">
		<div class="mb-4 grid gap-2">
			<h2 class="text-lg font-semibold text-zinc-900">Running Nodes</h2>
			<p class="text-sm text-zinc-600">Nodes that are currently running and processing data.</p>
		</div>
		{#if isLoading}
			<p>Loading nodes...</p>
		{:else if errorMessage}
			<p class="text-red-600">{errorMessage}</p>
		{:else if nodes.length === 0}
			<p>No nodes found.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500">
							<th class="px-2 py-2 font-medium">Node</th>
							<th class="px-2 py-2 font-medium">Status</th>
							<th class="px-2 py-2 font-medium">Publishes</th>
							<th class="px-2 py-2 font-medium">Last Publish</th>
							<th class="px-2 py-2 font-medium">CPU</th>
							<th class="px-2 py-2 font-medium">Mem %</th>
							<th class="px-2 py-2 font-medium">Disk %</th>
						</tr>
					</thead>
					<tbody>
						{#each nodes as node (node.id)}
							<tr class="border-b border-zinc-100">
								<td class="px-2 py-2">
									<p class="font-medium text-zinc-900">{node.name ?? node.id}</p>
									<p class="text-xs text-zinc-500">{node.id}</p>
								</td>
								<td class="px-2 py-2 text-zinc-700">{isNodeActive(node) ? "Active" : "Idle"}</td>
								<td class="px-2 py-2 text-zinc-700">{node.publishCount ?? 0}</td>
								<td class="px-2 py-2 text-zinc-700">
									{node.lastPublishAt ? new Date(node.lastPublishAt).toLocaleString() : "n/a"}
								</td>
								<td class="px-2 py-2 text-zinc-700">
									{node.latestMetric ? `${(node.latestMetric.cpu * 100).toFixed(1)}%` : "n/a"}
								</td>
								<td class="px-2 py-2 text-zinc-700">
									{node.latestMetric
										? formatPercent(node.latestMetric.memUsed, node.latestMetric.memTotal)
										: "n/a"}
								</td>
								<td class="px-2 py-2 text-zinc-700">
									{node.latestMetric
										? formatPercent(node.latestMetric.diskUsed, node.latestMetric.diskTotal)
										: "n/a"}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</main>
