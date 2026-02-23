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
	let showCreateNodeModal = false;
	let serverHostOrDomain = "";
	let serverPort = "3001";
	let nodeImageRepo = "gustavpetterssonbjorklund/statix-node";
	let nodeImageTag = "latest";

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

		const trimmedName = newNodeName.trim();
		if (!trimmedName) {
			createNodeError = "Node name is required";
			return;
		}

		createNodeBusy = true;

		try {
			const response = await fetch("/api/nodes/create", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${authToken}`
				},
				body: JSON.stringify({ name: trimmedName })
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

	function openCreateNodeModal() {
		showCreateNodeModal = true;
		createNodeError = "";
	}

	function closeCreateNodeModal() {
		showCreateNodeModal = false;
	}

	function normalizeHost(value: string) {
		const trimmed = value.trim();
		if (!trimmed) {
			return "";
		}
		return trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "");
	}

	function buildNodeComposeFile(params: {
		nodeId: string;
		nodeToken: string;
		hostOrDomain: string;
		port: string;
		imageRepo: string;
		imageTag: string;
	}) {
		const safePort = Number.isFinite(Number(params.port)) && Number(params.port) > 0 ? params.port : "3001";
		const host = normalizeHost(params.hostOrDomain) || "127.0.0.1";
		const imageRepo = params.imageRepo.trim() || "gustavpetterssonbjorklund/statix-node";
		const imageTag = params.imageTag.trim() || "latest";

		return `services:
  node_agent:
    image: ${imageRepo}:${imageTag}
    container_name: statix-node-agent
    restart: unless-stopped
    environment:
      NODE_ID: "${params.nodeId}"
      NODE_TOKEN: "${params.nodeToken}"
      API_BASE_URL: "http://${host}:${safePort}"
      NODE_AUTH_EXCHANGE_PATH: "/nodes/auth/exchange"
      NODE_METRICS_TOPIC: "statix/nodes/{nodeId}/metrics"
      NODE_SYSTEM_INFO_TOPIC: "statix/nodes/{nodeId}/system"
      PUBLISH_INTERVAL_MS: "5000"
      SYSTEM_INFO_CHECK_INTERVAL_MS: "600000"
      SYSTEM_INFO_REPUBLISH_INTERVAL_MS: "86400000"
      EXCHANGE_INTERVAL_MS: "900000"
      RECONNECT_DELAY_MS: "3000"
      MQTT_CONNECT_TIMEOUT_MS: "8000"`;
	}

	$: generatedNodeComposeFile =
		createdNodeId && createdNodeToken
			? buildNodeComposeFile({
					nodeId: createdNodeId,
					nodeToken: createdNodeToken,
					hostOrDomain: serverHostOrDomain,
					port: serverPort,
					imageRepo: nodeImageRepo,
					imageTag: nodeImageTag
				})
			: "";
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
				<button
					class="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800"
					on:click={openCreateNodeModal}
				>
					Create Node Token
				</button>
				{#if showCreateNodeModal}
					<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
						<div class="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl bg-white p-5 shadow-xl">
							<div class="mb-4 flex items-center justify-between">
								<h3 class="text-lg font-semibold text-zinc-900">Create Node Token</h3>
								<button class="rounded px-2 py-1 text-zinc-600 hover:bg-zinc-100" on:click={closeCreateNodeModal}
									>Close</button
								>
							</div>

							<div class="space-y-4">
								<div class="grid gap-3 md:grid-cols-2">
									<label class="text-xs text-zinc-700">
										Node name
										<input
											class="mt-1 w-full rounded border-zinc-300 text-sm"
											placeholder="Node name"
											bind:value={newNodeName}
										/>
									</label>
									<label class="text-xs text-zinc-700">
										Server host or domain
										<input
											class="mt-1 w-full rounded border-zinc-300 text-sm"
											placeholder="example.com or 192.168.1.20"
											bind:value={serverHostOrDomain}
										/>
									</label>
									<label class="text-xs text-zinc-700">
										Server API port
										<input class="mt-1 w-full rounded border-zinc-300 text-sm" bind:value={serverPort} />
									</label>
									<label class="text-xs text-zinc-700">
										Node image repo
										<input class="mt-1 w-full rounded border-zinc-300 text-sm" bind:value={nodeImageRepo} />
									</label>
									<label class="text-xs text-zinc-700">
										Node image tag
										<input class="mt-1 w-full rounded border-zinc-300 text-sm" bind:value={nodeImageTag} />
									</label>
								</div>

								<p class="text-xs text-zinc-600">
									Use a publicly reachable server host/domain if the node runs on another machine.
								</p>

								<div>
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
										<p class="text-sm font-medium text-zinc-900">Node `.env` (legacy/manual):</p>
										<pre class="overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{createdNodeEnvFile || `NODE_ID=${createdNodeId}
NODE_TOKEN=${createdNodeToken}
API_BASE_URL=http://127.0.0.1:3001
NODE_AUTH_EXCHANGE_PATH=/nodes/auth/exchange
NODE_METRICS_TOPIC=statix/nodes/{nodeId}/metrics
NODE_SYSTEM_INFO_TOPIC=statix/nodes/{nodeId}/system
PUBLISH_INTERVAL_MS=5000
SYSTEM_INFO_CHECK_INTERVAL_MS=600000
SYSTEM_INFO_REPUBLISH_INTERVAL_MS=86400000
EXCHANGE_INTERVAL_MS=900000
RECONNECT_DELAY_MS=3000
MQTT_CONNECT_TIMEOUT_MS=8000`}</pre>
									</div>
									<div class="space-y-2">
										<p class="text-sm font-medium text-zinc-900">Ready `compose.node.yml`:</p>
										<pre class="overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{generatedNodeComposeFile}</pre>
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/if}
			</div>
		</Card>
	{/if}
</main>
