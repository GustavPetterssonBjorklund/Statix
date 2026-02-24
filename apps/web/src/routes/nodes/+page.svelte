<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import NavDrawer from "$lib/components/generic/NavDrawer.svelte";
	import { clearAuthToken, getAuthToken, validateAuthToken } from "$lib/auth";
	import { drawerLinks } from "$lib/config/drawer";
	import { connectLiveNodes } from "$lib/live-nodes";

	type NodeDto = {
		id: string;
		name: string | null;
		lastSeenAt: string;
		createdAt: string;
		updatedAt: string;
		publishCount?: number;
		lastPublishAt?: string | null;
	};

	const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

	let nodes: NodeDto[] = [];
	let loading = true;
	let errorMessage = "";
	let authToken = "";
	let searchTerm = "";
	let deletingNodeIds = new Set<string>();
	let pendingDeleteNodeId = "";

	function toMillis(value?: string | null) {
		if (!value) {
			return null;
		}

		const ms = Date.parse(value);
		return Number.isNaN(ms) ? null : ms;
	}

	function isNonActivated(node: NodeDto) {
		return (node.publishCount ?? 0) <= 0 || toMillis(node.lastPublishAt) === null;
	}

	function isAlive(node: NodeDto) {
		const publishedAt = toMillis(node.lastPublishAt);
		return publishedAt !== null && Date.now() - publishedAt <= ACTIVE_WINDOW_MS;
	}

	function isDead(node: NodeDto) {
		return !isNonActivated(node) && !isAlive(node);
	}

	function formatLastPublish(node: NodeDto) {
		const publishedMs = toMillis(node.lastPublishAt);
		if (publishedMs === null) {
			return "Never";
		}
		return new Date(publishedMs).toLocaleString();
	}

	function nodeLabel(node: NodeDto) {
		return node.name?.trim() || node.id;
	}

	function statusLabel(node: NodeDto) {
		if (isDead(node)) {
			return "dead";
		}
		if (isAlive(node)) {
			return "alive";
		}
		return "non activated";
	}

	function matchesSearch(node: NodeDto, query: string) {
		const term = query.trim().toLowerCase();
		if (!term) {
			return true;
		}

		return (
			node.id.toLowerCase().includes(term) ||
			(node.name ?? "").toLowerCase().includes(term) ||
			statusLabel(node).includes(term)
		);
	}

	function formatNumber(value: number) {
		return new Intl.NumberFormat().format(value);
	}

	function parseJsonResponse(text: string) {
		if (!text) {
			return null;
		}

		try {
			return JSON.parse(text) as { error?: unknown; details?: unknown };
		} catch {
			return null;
		}
	}

	function openDeleteModal(nodeId: string) {
		pendingDeleteNodeId = nodeId;
	}

	function closeDeleteModal() {
		pendingDeleteNodeId = "";
	}

	async function confirmDeleteNode() {
		const nodeId = pendingDeleteNodeId;
		if (!nodeId) {
			return;
		}

		if (!authToken) {
			errorMessage = "Missing auth token. Please log in again.";
			return;
		}

		closeDeleteModal();

		deletingNodeIds = new Set(deletingNodeIds).add(nodeId);
		try {
			const response = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}`, {
				method: "DELETE",
				headers: {
					authorization: `Bearer ${authToken}`
				}
			});

			if (!response.ok) {
				const text = await response.text();
				const parsed = parseJsonResponse(text);
				const fallback = parsed?.details ?? parsed?.error ?? text;
				errorMessage = typeof fallback === "string" && fallback ? fallback : "Failed to delete node";
				return;
			}

			nodes = nodes.filter((entry) => entry.id !== nodeId);
		} catch {
			errorMessage = "Unable to delete node";
		} finally {
			const next = new Set(deletingNodeIds);
			next.delete(nodeId);
			deletingNodeIds = next;
		}
	}

	$: deadNodes = nodes.filter(isDead);
	$: aliveNodes = nodes.filter(isAlive);
	$: nonActivatedNodes = nodes.filter(isNonActivated);
	$: pendingDeleteNode = nodes.find((node) => node.id === pendingDeleteNodeId) ?? null;
	$: filteredNodes = nodes.filter((node) => matchesSearch(node, searchTerm));
	$: deadFilteredNodes = filteredNodes.filter(isDead);
	$: aliveFilteredNodes = filteredNodes.filter(isAlive);
	$: nonActivatedFilteredNodes = filteredNodes.filter(isNonActivated);
	$: prioritizedNodes = [...deadFilteredNodes, ...aliveFilteredNodes, ...nonActivatedFilteredNodes];
	$: totalPublishes = nodes.reduce((total, node) => total + (node.publishCount ?? 0), 0);
	$: filteredPublishes = filteredNodes.reduce((total, node) => total + (node.publishCount ?? 0), 0);
	$: aliveRate = nodes.length > 0 ? (aliveNodes.length / nodes.length) * 100 : 0;
	$: deadRate = nodes.length > 0 ? (deadNodes.length / nodes.length) * 100 : 0;
	$: neverPublishedRate = nodes.length > 0 ? (nonActivatedNodes.length / nodes.length) * 100 : 0;
	$: mostRecentPublishMs = nodes.reduce<number | null>((latest, node) => {
		const publishedMs = toMillis(node.lastPublishAt);
		if (publishedMs === null) {
			return latest;
		}
		if (latest === null || publishedMs > latest) {
			return publishedMs;
		}
		return latest;
	}, null);

	onMount(() => {
		let stopLiveNodes = () => {};

		void (async () => {
			const token = getAuthToken();
			if (!token) {
				await goto("/login");
				return;
			}
			authToken = token;

			const user = await validateAuthToken(token);
			if (!user) {
				clearAuthToken();
				await goto("/login");
				return;
			}

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
				loading = false;
			}

			stopLiveNodes = connectLiveNodes<NodeDto>(
				(liveNodes) => {
					nodes = Array.isArray(liveNodes) ? liveNodes : [];
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

<main class="space-y-5 p-6 pl-72">
	<NavDrawer links={drawerLinks} />

	<header class="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
		<h1 class="text-2xl font-bold text-zinc-900">Nodes Status</h1>
		<p class="mt-1 text-sm text-zinc-600">Priority order: dead, alive, non activated.</p>
	</header>

	{#if errorMessage}
		<div class="rounded-md bg-red-50 p-4 text-sm font-medium text-red-800">{errorMessage}</div>
	{/if}

	{#if loading}
		<div class="text-sm text-zinc-500">Loading nodes...</div>
	{:else}
		<section class="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
			<article class="rounded-xl border border-red-200 bg-red-50 p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-red-700">Dead</p>
				<p class="mt-2 text-2xl font-bold text-red-900">{deadNodes.length}</p>
				<p class="text-xs text-red-700">{deadRate.toFixed(1)}%</p>
			</article>
			<article class="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-emerald-700">Alive</p>
				<p class="mt-2 text-2xl font-bold text-emerald-900">{aliveNodes.length}</p>
				<p class="text-xs text-emerald-700">{aliveRate.toFixed(1)}%</p>
			</article>
			<article class="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-zinc-600">Non Activated</p>
				<p class="mt-2 text-2xl font-bold text-zinc-900">{nonActivatedNodes.length}</p>
				<p class="text-xs text-zinc-600">{neverPublishedRate.toFixed(1)}%</p>
			</article>
			<article class="rounded-xl border border-zinc-200 bg-white p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-zinc-600">Total Nodes</p>
				<p class="mt-2 text-2xl font-bold text-zinc-900">{nodes.length}</p>
				<p class="text-xs text-zinc-600">filtered: {filteredNodes.length}</p>
			</article>
			<article class="rounded-xl border border-zinc-200 bg-white p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-zinc-600">Publishes</p>
				<p class="mt-2 text-2xl font-bold text-zinc-900">{formatNumber(totalPublishes)}</p>
				<p class="text-xs text-zinc-600">filtered: {formatNumber(filteredPublishes)}</p>
			</article>
			<article class="rounded-xl border border-zinc-200 bg-white p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-zinc-600">Latest Publish</p>
				<p class="mt-2 text-sm font-semibold text-zinc-900">
					{mostRecentPublishMs === null ? "Never" : new Date(mostRecentPublishMs).toLocaleString()}
				</p>
			</article>
		</section>

		<section class="rounded-xl border border-zinc-200 bg-white p-4">
			<label for="node-search" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-600"
				>Search</label
			>
			<input
				id="node-search"
				class="w-full rounded-md border-zinc-300 text-sm"
				placeholder="Search by node id, name, or status..."
				bind:value={searchTerm}
			/>
		</section>

		{#if prioritizedNodes.length === 0}
			<div class="rounded-md bg-yellow-50 p-4 text-sm font-medium text-yellow-800">
				{searchTerm.trim() ? "No nodes matched your search." : "No nodes found."}
			</div>
		{:else}
			<section class="space-y-3">
				{#if deadFilteredNodes.length > 0}
					<h2 class="text-sm font-semibold uppercase tracking-wide text-red-700">Dead Nodes (Priority)</h2>
					{#each deadFilteredNodes as node (node.id)}
						<article class="rounded-xl border border-red-200 bg-white p-4 shadow-sm">
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="text-base font-semibold text-zinc-900">{nodeLabel(node)}</p>
									<p class="text-xs text-zinc-500">{node.id}</p>
								</div>
								<div class="flex items-center gap-2">
									<span class="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">Dead</span>
									<button
										class="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
										onclick={() => openDeleteModal(node.id)}
										disabled={deletingNodeIds.has(node.id)}
									>
										{deletingNodeIds.has(node.id) ? "Deleting..." : "Delete"}
									</button>
								</div>
							</div>
							<p class="mt-2 text-sm text-zinc-700">Last publish: {formatLastPublish(node)}</p>
							<p class="text-xs text-zinc-500">Publishes: {formatNumber(node.publishCount ?? 0)}</p>
						</article>
					{/each}
				{/if}

				{#if aliveFilteredNodes.length > 0}
					<h2 class="pt-2 text-sm font-semibold uppercase tracking-wide text-emerald-700">Alive Nodes</h2>
					{#each aliveFilteredNodes as node (node.id)}
						<article class="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="text-base font-semibold text-zinc-900">{nodeLabel(node)}</p>
									<p class="text-xs text-zinc-500">{node.id}</p>
								</div>
								<div class="flex items-center gap-2">
									<span class="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700"
										>Alive</span
									>
									<button
										class="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
										onclick={() => openDeleteModal(node.id)}
										disabled={deletingNodeIds.has(node.id)}
									>
										{deletingNodeIds.has(node.id) ? "Deleting..." : "Delete"}
									</button>
								</div>
							</div>
							<p class="mt-2 text-sm text-zinc-700">Last publish: {formatLastPublish(node)}</p>
							<p class="text-xs text-zinc-500">Publishes: {formatNumber(node.publishCount ?? 0)}</p>
						</article>
					{/each}
				{/if}

				{#if nonActivatedFilteredNodes.length > 0}
					<h2 class="pt-2 text-sm font-semibold uppercase tracking-wide text-zinc-600">Non Activated Nodes</h2>
					{#each nonActivatedFilteredNodes as node (node.id)}
						<article class="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="text-base font-semibold text-zinc-900">{nodeLabel(node)}</p>
									<p class="text-xs text-zinc-500">{node.id}</p>
								</div>
								<div class="flex items-center gap-2">
									<span class="rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700"
										>Non Activated</span
									>
									<button
										class="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-60"
										onclick={() => openDeleteModal(node.id)}
										disabled={deletingNodeIds.has(node.id)}
									>
										{deletingNodeIds.has(node.id) ? "Deleting..." : "Delete"}
									</button>
								</div>
							</div>
							<p class="mt-2 text-sm text-zinc-700">Last publish: Never</p>
							<p class="text-xs text-zinc-500">Publishes: {formatNumber(node.publishCount ?? 0)}</p>
						</article>
					{/each}
				{/if}
			</section>
		{/if}
	{/if}
</main>

{#if pendingDeleteNode}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			class="absolute inset-0 bg-black/50"
			aria-label="Close delete dialog"
			onclick={closeDeleteModal}
		></button>
		<div
			class="relative w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"
			role="dialog"
			aria-modal="true"
			aria-labelledby="delete-node-title"
			tabindex="-1"
		>
			<h2 id="delete-node-title" class="text-lg font-bold text-zinc-900">Delete Node</h2>
			<p class="mt-2 text-sm text-zinc-700">
				You are about to permanently delete this node and its metric history.
			</p>

			<div class="mt-4 space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
				<div class="flex items-start justify-between gap-4">
					<span class="font-semibold text-zinc-700">Name</span>
					<span class="text-right text-zinc-900">{nodeLabel(pendingDeleteNode)}</span>
				</div>
				<div class="flex items-start justify-between gap-4">
					<span class="font-semibold text-zinc-700">Node ID</span>
					<span class="text-right font-mono text-xs text-zinc-900">{pendingDeleteNode.id}</span>
				</div>
				<div class="flex items-start justify-between gap-4">
					<span class="font-semibold text-zinc-700">Status</span>
					<span class="text-right capitalize text-zinc-900">{statusLabel(pendingDeleteNode)}</span>
				</div>
				<div class="flex items-start justify-between gap-4">
					<span class="font-semibold text-zinc-700">Publishes</span>
					<span class="text-right text-zinc-900">{formatNumber(pendingDeleteNode.publishCount ?? 0)}</span>
				</div>
				<div class="flex items-start justify-between gap-4">
					<span class="font-semibold text-zinc-700">Last publish</span>
					<span class="text-right text-zinc-900">{formatLastPublish(pendingDeleteNode)}</span>
				</div>
			</div>

			<div class="mt-5 flex items-center justify-end gap-2">
				<button
					class="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
					onclick={closeDeleteModal}
				>
					Cancel
				</button>
				<button
					class="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500"
					onclick={confirmDeleteNode}
				>
					Delete Node
				</button>
			</div>
		</div>
	</div>
{/if}
