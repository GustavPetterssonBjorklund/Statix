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
	};

	let user: AuthUser | null = null;
	let nodes: NodeDto[] = [];
	let needsBootstrap = false;
	let loading = true;
	let errorMessage = "";
	let authToken = "";
	let newNodeName = "";
	let createNodeBusy = false;
	let createNodeError = "";
	let createdNodeId = "";
	let createdNodeToken = "";
	let createdNodeEnvFile = "";

	async function fetchJson(path: string, init?: RequestInit) {
		const response = await fetch(path, init);
		const text = await response.text();
		const data = text ? JSON.parse(text) : null;
		return { response, data };
	}

	onMount(() => {
		let stopLiveNodes = () => {};

		void (async () => {
			const token = getAuthToken();
			if (!token) {
				await goto("/login");
				return;
			}
			authToken = token;

			const authUser = await validateAuthToken(token);
			if (!authUser) {
				clearAuthToken();
				await goto("/login");
				return;
			}

			user = authUser as AuthUser;
			if (!user.roles.includes("admin")) {
				await goto("/dashboard");
				return;
			}

			try {
				const [nodesResult, bootstrapResult] = await Promise.all([
					fetchJson("/api/nodes"),
					fetchJson("/api/auth/bootstrap/status")
				]);

				if (!nodesResult.response.ok) {
					errorMessage = "Failed to load nodes";
					return;
				}
				if (!bootstrapResult.response.ok) {
					errorMessage = "Failed to load bootstrap status";
					return;
				}

				nodes = Array.isArray(nodesResult.data) ? nodesResult.data : [];
				needsBootstrap =
					typeof bootstrapResult.data?.needsBootstrap === "boolean"
						? bootstrapResult.data.needsBootstrap
						: false;
			} catch {
				errorMessage = "Unable to load admin stats";
			} finally {
				loading = false;
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

	async function createNodeToken() {
		createNodeError = "";
		createdNodeId = "";
		createdNodeToken = "";
		createdNodeEnvFile = "";
		createNodeBusy = true;

		try {
			const response = await fetch("/api/nodes", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${authToken}`
				},
				body: JSON.stringify({ name: newNodeName })
			});
			const data = await response.json();

			if (!response.ok) {
				createNodeError = data?.error ?? "Failed to create node";
				return;
			}

			createdNodeId = typeof data?.id === "string" ? data.id : "";
			createdNodeToken = typeof data?.token === "string" ? data.token : "";
			createdNodeEnvFile = typeof data?.envFile === "string" ? data.envFile : "";
			if (createdNodeId) {
				nodes = [
					{
						id: createdNodeId,
						name: typeof data?.name === "string" ? data.name : null,
						lastSeenAt: typeof data?.createdAt === "string" ? data.createdAt : new Date().toISOString(),
						createdAt: typeof data?.createdAt === "string" ? data.createdAt : new Date().toISOString(),
						updatedAt: typeof data?.createdAt === "string" ? data.createdAt : new Date().toISOString(),
						publishCount: 0,
						lastPublishAt: null
					},
					...nodes
				];
			}
		} catch {
			createNodeError = "Unable to reach API service";
		} finally {
			createNodeBusy = false;
		}
	}
</script>

<main class="mx-auto max-w-6xl space-y-6 p-6 pl-72">
	<NavDrawer title={drawerTitles.admin} links={drawerLinks} />
	<header class="rounded-2xl border border-zinc-200 bg-gradient-to-r from-zinc-900 to-zinc-700 p-6 text-white shadow-sm">
		<p class="text-xs uppercase tracking-[0.16em] text-zinc-300">Admin Console</p>
		<h1 class="mt-2 text-3xl font-bold">Operational Snapshot</h1>
		<p class="mt-1 text-sm text-zinc-200">Welcome {user?.displayName ?? user?.email ?? "admin"}.</p>
	</header>

	{#if loading}
		<Card title="Loading" subtitle="Collecting admin stats...">
			<p class="text-zinc-600">Please wait.</p>
		</Card>
	{:else if errorMessage}
		<Card title="Error" subtitle="Could not load the admin view.">
			<p class="text-red-600">{errorMessage}</p>
		</Card>
	{:else}
		<section class="grid gap-4 md:grid-cols-4">
			<article class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
				<p class="text-xs uppercase tracking-wide text-zinc-500">Nodes</p>
				<p class="mt-2 text-3xl font-bold text-zinc-900">{nodes.length}</p>
				<p class="mt-1 text-sm text-zinc-600">Registered in cluster</p>
			</article>

			<article class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
				<p class="text-xs uppercase tracking-wide text-zinc-500">Bootstrap</p>
				<p class="mt-2 text-3xl font-bold {needsBootstrap ? 'text-amber-600' : 'text-emerald-600'}">
					{needsBootstrap ? "Pending" : "Complete"}
				</p>
				<p class="mt-1 text-sm text-zinc-600">Initial admin state</p>
			</article>

			<article class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
				<p class="text-xs uppercase tracking-wide text-zinc-500">Role</p>
				<p class="mt-2 text-3xl font-bold text-zinc-900">Admin</p>
				<p class="mt-1 text-sm text-zinc-600">Current privileges</p>
			</article>

			<article class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
				<p class="text-xs uppercase tracking-wide text-zinc-500">Last Node Seen</p>
				<p class="mt-2 text-lg font-semibold text-zinc-900">
					{nodes[0]?.lastPublishAt ? new Date(nodes[0].lastPublishAt).toLocaleString() : "n/a"}
				</p>
				<p class="mt-1 text-sm text-zinc-600">Most recent publish</p>
			</article>
		</section>

		<Card title="Admin Actions" subtitle="Use the left sidebar for quick navigation.">
			<div class="space-y-4">
				<div class="grid gap-3 md:grid-cols-[1fr_auto]">
					<input
						class="w-full rounded border-zinc-300"
						placeholder="Node name"
						bind:value={newNodeName}
					/>
					<button
						class="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800 disabled:opacity-60"
						on:click={createNodeToken}
						disabled={createNodeBusy}
					>
						{createNodeBusy ? "Creating..." : "Create node token"}
					</button>
				</div>
				{#if createNodeError}
					<p class="text-sm text-red-600">{createNodeError}</p>
				{/if}
					{#if createdNodeId && createdNodeToken}
						<div class="space-y-2">
							<p class="text-sm font-medium text-zinc-900">Copy this into node `.env`:</p>
							<pre class="overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{createdNodeEnvFile || `NODE_ID=${createdNodeId}
NODE_TOKEN=${createdNodeToken}
API_BASE_URL=http://127.0.0.1:3001
NODE_AUTH_EXCHANGE_PATH=/nodes/auth/exchange
NODE_METRICS_TOPIC=statix/nodes/{nodeId}/metrics
PUBLISH_INTERVAL_MS=5000
EXCHANGE_INTERVAL_MS=900000
RECONNECT_DELAY_MS=3000
MQTT_CONNECT_TIMEOUT_MS=8000`}</pre>
						</div>
					{/if}
				</div>
		</Card>
	{/if}
</main>
