<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { Card, NavDrawer } from "$lib";
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

	let nodes: NodeDto[] = [];
	let isLoading = true;
	let errorMessage = "";
	let currentUser: AuthUser | null = null;
	let isAdmin = false;
	let selectedNodeId = "";
	const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

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

	function dialStyle(percent: number, color: string) {
		const normalized = Math.max(0, Math.min(100, percent));
		return `background: conic-gradient(${color} 0deg ${normalized * 3.6}deg, #e4e4e7 ${normalized * 3.6}deg 360deg);`;
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
	$: topPublisher = nodes.reduce<NodeDto | null>((top, node) => {
		if (!top || (node.publishCount ?? 0) > (top.publishCount ?? 0)) {
			return node;
		}
		return top;
	}, null);
	$: rankedNodes = [...nodes].sort((a, b) => (b.publishCount ?? 0) - (a.publishCount ?? 0)).slice(0, 5);
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

	onMount(() => {
		let stopLiveNodes = () => {};

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
			isAdmin = currentUser.roles.includes("admin");

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
		})();

		return () => {
			stopLiveNodes();
		};
	});
</script>

<main class="mx-auto max-w-6xl space-y-6 p-6 pl-72">
	<NavDrawer title={drawerTitles.dashboard} links={drawerLinks} />
	<header class="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
		<p class="text-xs font-medium uppercase tracking-wider text-zinc-500">Statix Dashboard</p>
		<h1 class="mt-2 text-3xl font-bold text-zinc-900">Cluster Overview</h1>
		<p class="mt-1 text-sm text-zinc-600">
			Signed in as {currentUser?.displayName ?? currentUser?.email ?? "user"}
		</p>
	</header>

	{#if isAdmin}
		<Card
			title="Admin Quick Panel"
			subtitle="Fast access to admin tooling and high-level stats."
			class="border-emerald-200 bg-gradient-to-br from-emerald-50 to-white"
		>
			<div class="grid gap-4 md:grid-cols-3">
				<div class="rounded-xl border border-emerald-200 bg-white p-4">
					<p class="text-xs uppercase tracking-wide text-emerald-700">Total Nodes</p>
					<p class="mt-2 text-2xl font-semibold text-zinc-900">{nodes.length}</p>
				</div>
				<div class="rounded-xl border border-emerald-200 bg-white p-4">
					<p class="text-xs uppercase tracking-wide text-emerald-700">Your Role</p>
					<p class="mt-2 text-2xl font-semibold text-zinc-900">Admin</p>
				</div>
				<div class="rounded-xl border border-emerald-200 bg-white p-4">
					<p class="text-xs uppercase tracking-wide text-emerald-700">Auth Tools</p>
					<p class="mt-2 text-sm text-zinc-600">Use the left sidebar for admin navigation.</p>
				</div>
			</div>
		</Card>
	{/if}

	<Card
		title="Node Statistics"
		subtitle="Live publish activity from node MQTT ingestion."
		class="border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-amber-50"
	>
		{#if isLoading}
			<p class="text-zinc-600">Building node statistics...</p>
		{:else if errorMessage}
			<p class="text-red-600">{errorMessage}</p>
		{:else}
			<div class="grid gap-4 md:grid-cols-4">
				<article class="rounded-xl border border-cyan-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-cyan-700">Total Publishes</p>
					<p class="mt-2 text-3xl font-bold text-zinc-900">{totalPublishes}</p>
				</article>
				<article class="rounded-xl border border-emerald-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-emerald-700">Active Nodes (2m)</p>
					<p class="mt-2 text-3xl font-bold text-zinc-900">{activeNodes}</p>
				</article>
				<article class="rounded-xl border border-amber-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-amber-700">Avg Publishes / Node</p>
					<p class="mt-2 text-3xl font-bold text-zinc-900">{avgPublishesPerNode}</p>
				</article>
				<article class="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-zinc-500">Latest Publish</p>
					<p class="mt-2 text-3xl font-bold text-zinc-900">{formatRelative(freshestPublishMs)}</p>
				</article>
			</div>

			<div class="mt-4 grid gap-4 md:grid-cols-2">
				<div class="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-zinc-500">Top Publisher</p>
					<p class="mt-2 text-xl font-semibold text-zinc-900">{topPublisher?.name ?? topPublisher?.id ?? "n/a"}</p>
					<p class="mt-1 text-sm text-zinc-600">
						{topPublisher ? `${topPublisher.publishCount ?? 0} publishes` : "No publish data yet"}
					</p>
				</div>
				<div class="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-zinc-500">Cluster Health</p>
					<p class="mt-2 text-xl font-semibold text-zinc-900">
						{activeNodes > 0 ? "Receiving telemetry" : "No active telemetry"}
					</p>
					<p class="mt-1 text-sm text-zinc-600">
						{inactiveNodes} node{inactiveNodes === 1 ? "" : "s"} inactive in the last 2 minutes
					</p>
				</div>
			</div>

			{#if rankedNodes.length > 0}
				<div class="mt-4 rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-zinc-500">Top Nodes by Publish Volume</p>
					<ul class="mt-3 space-y-2">
						{#each rankedNodes as node (node.id)}
							<li class="grid grid-cols-[1fr_auto] items-center gap-3">
								<p class="truncate text-sm font-medium text-zinc-800">{node.name ?? node.id}</p>
								<p class="text-xs text-zinc-600">{node.publishCount ?? 0}</p>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		{/if}
	</Card>

	<Card
		title="Selected Node"
		subtitle="Focused telemetry snapshot for one node."
		class="border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50"
	>
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

			<div class="grid gap-4 md:grid-cols-4">
				<article class="rounded-xl border border-indigo-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-indigo-700">Status</p>
					<p class="mt-2 text-2xl font-semibold text-zinc-900">{selectedNodeStatus}</p>
				</article>
				<article class="rounded-xl border border-cyan-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-cyan-700">Publishes</p>
					<p class="mt-2 text-2xl font-semibold text-zinc-900">{selectedNode.publishCount ?? 0}</p>
				</article>
				<article class="rounded-xl border border-amber-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-amber-700">Last Publish</p>
					<p class="mt-2 text-2xl font-semibold text-zinc-900">{formatRelative(selectedNodeLastPublishMs)}</p>
				</article>
				<article class="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-zinc-500">Node ID</p>
					<p class="mt-2 truncate text-sm font-medium text-zinc-900">{selectedNode.id}</p>
				</article>
			</div>

			<div class="mt-4 grid gap-4 md:grid-cols-2">
				<div class="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-zinc-500">Last Seen</p>
					<p class="mt-2 text-sm text-zinc-700">{new Date(selectedNode.lastSeenAt).toLocaleString()}</p>
				</div>
				<div class="rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
					<p class="text-xs uppercase tracking-wide text-zinc-500">Created</p>
					<p class="mt-2 text-sm text-zinc-700">{new Date(selectedNode.createdAt).toLocaleString()}</p>
				</div>
			</div>

			<div class="mt-4 rounded-xl border border-zinc-200 bg-white/90 p-4 shadow-sm">
				<p class="text-xs uppercase tracking-wide text-zinc-500">Latest Reported Metrics</p>
				{#if selectedNode.latestMetric}
					<div class="mt-3 grid gap-3 md:grid-cols-3">
						<div class="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3">
							<p class="text-xs uppercase tracking-wide text-cyan-700">CPU</p>
							<div class="mt-2 flex items-center gap-3">
								<div
									class="grid h-16 w-16 place-items-center rounded-full"
									style={dialStyle(selectedNode.latestMetric.cpu * 100, "#0891b2")}
								>
									<div class="grid h-11 w-11 place-items-center rounded-full bg-white text-xs font-semibold text-zinc-800">
										{(selectedNode.latestMetric.cpu * 100).toFixed(0)}%
									</div>
								</div>
								<p class="text-sm text-zinc-700">{(selectedNode.latestMetric.cpu * 100).toFixed(1)}% load</p>
							</div>
						</div>
						<div class="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
							<p class="text-xs uppercase tracking-wide text-emerald-700">Memory</p>
							<div class="mt-2 flex items-center gap-3">
								<div
									class="grid h-16 w-16 place-items-center rounded-full"
									style={dialStyle(
										percentValue(selectedNode.latestMetric.memUsed, selectedNode.latestMetric.memTotal),
										"#059669"
									)}
								>
									<div class="grid h-11 w-11 place-items-center rounded-full bg-white text-xs font-semibold text-zinc-800">
										{formatPercent(selectedNode.latestMetric.memUsed, selectedNode.latestMetric.memTotal)}
									</div>
								</div>
								<p class="text-sm text-zinc-700">
									{formatBytes(selectedNode.latestMetric.memUsed)} / {formatBytes(selectedNode.latestMetric.memTotal)}
								</p>
							</div>
						</div>
						<div class="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
							<p class="text-xs uppercase tracking-wide text-amber-700">Disk</p>
							<div class="mt-2 flex items-center gap-3">
								<div
									class="grid h-16 w-16 place-items-center rounded-full"
									style={dialStyle(
										percentValue(selectedNode.latestMetric.diskUsed, selectedNode.latestMetric.diskTotal),
										"#d97706"
									)}
								>
									<div class="grid h-11 w-11 place-items-center rounded-full bg-white text-xs font-semibold text-zinc-800">
										{formatPercent(selectedNode.latestMetric.diskUsed, selectedNode.latestMetric.diskTotal)}
									</div>
								</div>
								<p class="text-sm text-zinc-700">
									{formatBytes(selectedNode.latestMetric.diskUsed)} / {formatBytes(selectedNode.latestMetric.diskTotal)}
								</p>
							</div>
						</div>
					</div>

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
				{:else}
					<p class="mt-2 text-sm text-zinc-600">No metric sample has been ingested for this node yet.</p>
				{/if}
			</div>
		{/if}
	</Card>

	<Card title="Running Nodes" subtitle="Nodes that are currently running and processing data.">
		{#if isLoading}
			<p>Loading nodes...</p>
		{:else if errorMessage}
			<p class="text-red-600">{errorMessage}</p>
		{:else if nodes.length === 0}
			<p>No nodes found.</p>
		{:else}
			<ul class="space-y-2">
				{#each nodes as node (node.id)}
					<li class="rounded-lg border border-zinc-200 p-3">
						<p class="font-medium text-zinc-900">{node.name ?? node.id}</p>
						<p class="text-sm text-zinc-600">ID: {node.id}</p>
						<p class="text-sm text-zinc-600">
							Last seen: {new Date(node.lastSeenAt).toLocaleString()}
						</p>
						<p class="text-sm text-zinc-600">
							Publishes: {typeof node.publishCount === "number" ? node.publishCount : 0}
						</p>
						<p class="text-sm text-zinc-600">
							Last publish:
							{node.lastPublishAt ? new Date(node.lastPublishAt).toLocaleString() : " n/a"}
						</p>
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
</main>
