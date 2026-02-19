<script lang="ts">
	import { onMount } from "svelte";
	import { Card } from "$lib";

	type NodeDto = {
		id: string;
		name: string | null;
		lastSeenAt: string;
		createdAt: string;
		updatedAt: string;
	};

	let nodes: NodeDto[] = [];
	let isLoading = true;
	let errorMessage = "";

	onMount(async () => {
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
	});
</script>

<!-- Running nodes -->
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
				</li>
			{/each}
		</ul>
	{/if}
</Card>
