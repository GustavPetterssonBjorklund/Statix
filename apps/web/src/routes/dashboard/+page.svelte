<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { NavDrawer } from "$lib";
	import { clearAuthToken, getAuthToken, validateAuthToken } from "$lib/auth";
	import { drawerLinks, drawerTitles } from "$lib/config/drawer";
	import { connectLiveNodes } from "$lib/live-nodes";
	import MetricLineChart from "$lib/components/dashboard/MetricLineChart.svelte";
	import { TriangleAlert } from "lucide-svelte";


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
		systemInfo?: {
			hash: string;
			reportedTs: number;
			updatedAt: string;
			info: {
				osPlatform: string;
				osRelease: string;
				osArch: string;
				hostname: string;
				cpuModel: string;
				cpuCores: number;
				memTotal: number;
				agentVersion?: string;
				agentCommit?: string;
				agentBuiltAt?: string;
				gpus: Array<{
					name: string;
					vendor?: string;
					memoryBytes?: number;
					driverVersion?: string;
				}>;
			} | null;
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

	function formatBytesPerSecond(value: number | undefined) {
		if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
			return "n/a";
		}

		return `${formatBytes(value)}/s`;
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

	function buildRateSeries(values: number[], timestamps: number[]) {
		if (values.length === 0 || timestamps.length === 0) {
			return [];
		}

		return values.map((value, index) => {
			if (index === 0) {
				return 0;
			}

			const previousValue = values[index - 1];
			const previousTs = timestamps[index - 1];
			const currentTs = timestamps[index];
			if (
				typeof previousValue !== "number" ||
				typeof previousTs !== "number" ||
				typeof currentTs !== "number" ||
				!Number.isFinite(previousValue) ||
				!Number.isFinite(previousTs) ||
				!Number.isFinite(currentTs)
			) {
				return 0;
			}

			const bytesDelta = value - previousValue;
			const secondsDelta = (currentTs - previousTs) / 1000;
			if (secondsDelta <= 0 || bytesDelta < 0) {
				return 0;
			}

			return bytesDelta / secondsDelta;
		});
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
	$: selectedNodeSystemInfo = selectedNode?.systemInfo?.info ?? null;
	$: selectedNodeSystemReportedMs = selectedNode?.systemInfo?.reportedTs ?? null;
	$: cpuSeries = selectedNodeHistory.map((point) => point.cpu * 100);
	$: memSeries = selectedNodeHistory.map((point) => percentValue(point.memUsed, point.memTotal));
	$: timeSeries = selectedNodeHistory.map((point) => point.ts);
	$: diskSeries = selectedNodeHistory.map((point) => percentValue(point.diskUsed, point.diskTotal));
	$: netRxCounterSeries = selectedNodeHistory.map((point) => point.netRx);
	$: netTxCounterSeries = selectedNodeHistory.map((point) => point.netTx);
	$: netRxRateSeries = buildRateSeries(netRxCounterSeries, timeSeries);
	$: netTxRateSeries = buildRateSeries(netTxCounterSeries, timeSeries);
	$: selectedNodeLatestMetric = selectedNode?.latestMetric ?? null;
	$: selectedNodeCpuPercent =
		selectedNodeLatestMetric && Number.isFinite(selectedNodeLatestMetric.cpu)
			? Math.max(0, Math.min(100, selectedNodeLatestMetric.cpu * 100))
			: null;
	$: selectedNodeMemPercent = selectedNodeLatestMetric
		? percentValue(selectedNodeLatestMetric.memUsed, selectedNodeLatestMetric.memTotal)
		: null;
	$: selectedNodeDiskPercent = selectedNodeLatestMetric
		? percentValue(selectedNodeLatestMetric.diskUsed, selectedNodeLatestMetric.diskTotal)
		: null;
	$: selectedNodeNetRxRate =
		netRxRateSeries.length > 0 ? netRxRateSeries[netRxRateSeries.length - 1] : null;
	$: selectedNodeNetTxRate =
		netTxRateSeries.length > 0 ? netTxRateSeries[netTxRateSeries.length - 1] : null;

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

	{#if errorMessage}
		<div class="rounded-md bg-red-50 p-4">
			<div class="flex">
				<div class="flex-shrink-0">
					<TriangleAlert class="h-5 w-5 text-red-400" aria-hidden="true" />
				</div>
				<div class="ml-3">
					<p class="text-sm font-medium text-red-800">{errorMessage}</p>
				</div>
			</div>
		</div>
	{/if}

	{#if nodes.length === 0 && !isLoading}
		<div class="rounded-md bg-yellow-50 p-4">
			<div class="flex">
				<div class="flex-shrink-0">
					<TriangleAlert class="h-5 w-5 text-yellow-400" aria-hidden="true" />
				</div>
				<div class="ml-3">
					<p class="text-sm font-medium text-yellow-800">No nodes found</p>
				</div>
			</div>
		</div>
	{/if}

	{#if isLoading}
		<div class="text-center text-gray-500">Loading nodes...</div>
	{/if}

	<!-- Quick status alive / dead / pending -->
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<div class="rounded-lg bg-sky-50 p-4 shadow-sm ring-1 ring-sky-100">
			<div class="text-sm font-medium text-sky-700">Total Nodes</div>
			<div class="mt-1 text-2xl font-bold text-sky-900">{nodes.length}</div>
		</div>
		<div class="rounded-lg bg-emerald-50 p-4 shadow-sm ring-1 ring-emerald-100">
			<div class="text-sm font-medium text-emerald-700">Active Nodes</div>
			<div class="mt-1 text-2xl font-bold text-emerald-900">{activeNodes}</div>
		</div>
		<div class="rounded-lg bg-amber-50 p-4 shadow-sm ring-1 ring-amber-100">
			<div class="text-sm font-medium text-amber-700">Inactive Nodes</div>
			<div class="mt-1 text-2xl font-bold text-amber-900">{inactiveNodes}</div>
		</div>
	</div>
	
	<!-- Node selector -->
	{#if nodes.length > 0}
		<div>
			<label for="node-select" class="block text-sm font-medium text-gray-700">Select Node</label>
			<select
				id="node-select"
				class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 sm:text-sm"
				bind:value={selectedNodeId}
			>
				{#each nodes as node}
					<option value={node.id}>
						{node.name ?? node.id} {isNodeActive(node) ? "(active)" : "(idle)"}
					</option>
				{/each}
			</select>
		</div>
	{/if}

	<!-- If there is a selected node -->
	{#if selectedNode}
		<section class="space-y-4">
			<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
				<div class="rounded-lg bg-cyan-50 p-4 shadow-sm ring-1 ring-cyan-100">
					<div class="text-sm font-medium text-cyan-700">Current CPU</div>
					<div class="mt-1 text-2xl font-bold text-cyan-900">
						{selectedNodeCpuPercent === null ? "n/a" : `${selectedNodeCpuPercent.toFixed(1)}%`}
					</div>
				</div>
				<div class="rounded-lg bg-emerald-50 p-4 shadow-sm ring-1 ring-emerald-100">
					<div class="text-sm font-medium text-emerald-700">Current Memory</div>
					<div class="mt-1 text-2xl font-bold text-emerald-900">
						{selectedNodeMemPercent === null ? "n/a" : `${selectedNodeMemPercent.toFixed(1)}%`}
					</div>
					{#if selectedNodeLatestMetric}
						<div class="mt-1 text-xs text-emerald-800">
							{formatBytes(selectedNodeLatestMetric.memUsed)} / {formatBytes(selectedNodeLatestMetric.memTotal)}
						</div>
					{/if}
				</div>
				<div class="rounded-lg bg-amber-50 p-4 shadow-sm ring-1 ring-amber-100">
					<div class="text-sm font-medium text-amber-700">Current Disk</div>
					<div class="mt-1 text-2xl font-bold text-amber-900">
						{selectedNodeDiskPercent === null ? "n/a" : `${selectedNodeDiskPercent.toFixed(1)}%`}
					</div>
					{#if selectedNodeLatestMetric}
						<div class="mt-1 text-xs text-amber-800">
							{formatBytes(selectedNodeLatestMetric.diskUsed)} / {formatBytes(selectedNodeLatestMetric.diskTotal)}
						</div>
					{/if}
				</div>
			</div>

			<!-- Graphs -->
			<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<MetricLineChart
					title="CPU Usage"
					values={cpuSeries}
					timestamps={timeSeries}
					stroke="#0ea5e9"
					yDomain={[0, 100]}
					width={CHART_WIDTH}
					height={CHART_HEIGHT}
				/>
				<MetricLineChart
					title="Memory Usage"
					values={memSeries}
					timestamps={timeSeries}
					stroke="#22c55e"
					yDomain={[0, 100]}
					width={CHART_WIDTH}
					height={CHART_HEIGHT}
				/>
				<MetricLineChart
					title="Disk Usage"
					values={diskSeries}
					timestamps={timeSeries}
					stroke="#f59e0b"
					yDomain={[0, 100]}
					width={CHART_WIDTH}
					height={CHART_HEIGHT}
				/>
				<MetricLineChart
					title="Network Throughput (B/s)"
					values={netRxRateSeries}
					seriesLabel="RX Throughput"
					secondaryValues={netTxRateSeries}
					secondaryLabel="TX Throughput"
					secondaryStroke="#ec4899"
					timestamps={timeSeries}
					stroke="#6366f1"
					width={CHART_WIDTH}
					height={CHART_HEIGHT}
				/>
			</div>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
				<div class="rounded-lg bg-sky-50 p-4 shadow-sm ring-1 ring-sky-100">
					<div class="text-sm font-medium text-sky-700">Status</div>
					<div class="mt-1 text-2xl font-bold text-sky-900">{selectedNodeStatus}</div>
				</div>
				<div class="rounded-lg bg-emerald-50 p-4 shadow-sm ring-1 ring-emerald-100">
					<div class="text-sm font-medium text-emerald-700">Last Publish</div>
					<div class="mt-1 text-2xl font-bold text-emerald-900">{formatRelative(selectedNodeLastPublishMs)}</div>
				</div>
				<div class="rounded-lg bg-amber-50 p-4 shadow-sm ring-1 ring-amber-100">
					<div class="text-sm font-medium text-amber-700">Publishes</div>
					<div class="mt-1 text-2xl font-bold text-amber-900">{selectedNode.publishCount ?? "n/a"}</div>
				</div>
			</div>
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div class="rounded-lg bg-indigo-50 p-4 shadow-sm ring-1 ring-indigo-100">
					<div class="text-sm font-medium text-indigo-700">Current RX Throughput</div>
					<div class="mt-1 text-2xl font-bold text-indigo-900">{formatBytesPerSecond(selectedNodeNetRxRate ?? undefined)}</div>
				</div>
				<div class="rounded-lg bg-pink-50 p-4 shadow-sm ring-1 ring-pink-100">
					<div class="text-sm font-medium text-pink-700">Current TX Throughput</div>
					<div class="mt-1 text-2xl font-bold text-pink-900">{formatBytesPerSecond(selectedNodeNetTxRate ?? undefined)}</div>
				</div>
			</div>
			<div class="rounded-lg bg-indigo-50 p-4 shadow-sm ring-1 ring-indigo-100">
				<div class="mb-3 flex items-center justify-between">
					<div class="text-sm font-medium text-indigo-700">System Info</div>
					{#if selectedNodeSystemReportedMs}
						<div class="text-sm font-semibold text-indigo-900">
							updated {formatRelative(selectedNodeSystemReportedMs)}
						</div>
					{/if}
				</div>
				{#if selectedNodeSystemInfo}
					<div class="grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
						<div>
							<div class="text-indigo-700">OS</div>
							<div class="font-semibold text-indigo-950">
								{selectedNodeSystemInfo.osPlatform} {selectedNodeSystemInfo.osRelease} ({selectedNodeSystemInfo.osArch})
							</div>
						</div>
						<div>
							<div class="text-indigo-700">Hostname</div>
							<div class="font-semibold text-indigo-950">{selectedNodeSystemInfo.hostname}</div>
						</div>
						<div>
							<div class="text-indigo-700">CPU</div>
							<div class="font-semibold text-indigo-950">
								{selectedNodeSystemInfo.cpuModel} ({selectedNodeSystemInfo.cpuCores} cores)
							</div>
						</div>
						<div>
							<div class="text-indigo-700">Agent Version</div>
							<div class="font-semibold text-indigo-950">{selectedNodeSystemInfo.agentVersion ?? "unknown"}</div>
						</div>
						<div>
							<div class="text-indigo-700">Memory Capacity</div>
							<div class="font-semibold text-indigo-950">{formatBytes(selectedNodeSystemInfo.memTotal)}</div>
						</div>
						{#if selectedNodeSystemInfo.agentCommit}
							<div>
								<div class="text-indigo-700">Agent Commit</div>
								<div class="font-mono text-xs font-semibold text-indigo-950">{selectedNodeSystemInfo.agentCommit}</div>
							</div>
						{/if}
						{#if selectedNodeSystemInfo.agentBuiltAt}
							<div>
								<div class="text-indigo-700">Build Time</div>
								<div class="font-semibold text-indigo-950">{selectedNodeSystemInfo.agentBuiltAt}</div>
							</div>
						{/if}
						<div class="md:col-span-2">
							<div class="text-indigo-700">GPU(s)</div>
							{#if selectedNodeSystemInfo.gpus.length > 0}
								<div class="font-semibold text-indigo-950">
									{selectedNodeSystemInfo.gpus
										.map((gpu) => `${gpu.vendor ? `${gpu.vendor} ` : ""}${gpu.name}${gpu.memoryBytes ? ` (${formatBytes(gpu.memoryBytes)})` : ""}`)
										.join(" • ")}
								</div>
							{:else}
								<div class="font-semibold text-indigo-950">none detected</div>
							{/if}
						</div>
						{#if selectedNode?.systemInfo?.hash}
							<div class="md:col-span-2">
								<div class="text-indigo-700">Config Hash</div>
								<div class="font-mono text-xs font-semibold text-indigo-950">{selectedNode.systemInfo.hash}</div>
							</div>
						{/if}
					</div>
				{:else}
					<div class="text-sm font-semibold text-indigo-900">System inventory not reported yet.</div>
				{/if}
			</div>
		</section>
	{/if}

</main>
