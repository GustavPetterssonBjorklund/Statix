<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import statixFullLogo from "$lib/assets/staticsFull.svg";
  import { getAuthToken, setAuthToken, validateAuthToken } from "$lib/auth";

  let email = "";
  let password = "";
  let errorMessage = "";
  let isSubmitting = false;

  async function getBootstrapStatus() {
    try {
      const response = await fetch("/api/auth/bootstrap/status");
      const data = await response.json();
      if (!response.ok) {
        return false;
      }

      return data?.needsBootstrap === true;
    } catch {
      return false;
    }
  }

  onMount(async () => {
    const needsBootstrap = await getBootstrapStatus();
    if (needsBootstrap) {
      await goto("/bootstrap");
      return;
    }

    const token = getAuthToken();
    if (!token) {
      return;
    }

    const user = await validateAuthToken(token);
    if (user) {
      await goto("/dashboard");
    }
  });

  async function submitLogin() {
    errorMessage = "";
    isSubmitting = true;

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok || typeof data?.token !== "string") {
        errorMessage = data?.error ?? "Login failed";
        return;
      }

      setAuthToken(data.token);
      await goto("/dashboard");
    } catch {
      errorMessage = "Unable to reach auth service";
    } finally {
      isSubmitting = false;
    }
  }
</script>

<main class="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
  <section class="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
    <img src={statixFullLogo} alt="Statix" class="mx-auto mb-6 h-16 w-auto" />
    <h1 class="mb-1 text-center text-2xl font-semibold text-zinc-900">Sign in</h1>
    <p class="mb-6 text-center text-sm text-zinc-600">Use your Statix account to continue.</p>

    <form
      class="space-y-4"
      on:submit|preventDefault={submitLogin}
    >
      <label class="block">
        <span class="mb-1 block text-sm text-zinc-700">Email</span>
        <input class="w-full rounded border-zinc-300" type="email" bind:value={email} required />
      </label>
      <label class="block">
        <span class="mb-1 block text-sm text-zinc-700">Password</span>
        <input class="w-full rounded border-zinc-300" type="password" bind:value={password} required />
      </label>

      {#if errorMessage}
        <p class="text-sm text-red-600">{errorMessage}</p>
      {/if}

      <button
        class="w-full rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800 disabled:opacity-60"
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Signing in..." : "Sign in"}
      </button>
    </form>
  </section>
</main>
