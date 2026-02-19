<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import { clearAuthToken, getAuthToken, validateAuthToken } from "$lib/auth";

	onMount(async () => {
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

		await goto("/dashboard");
	});
</script>

<main class="flex min-h-screen items-center justify-center">
	<p class="text-sm text-zinc-500">Redirecting...</p>
</main>
