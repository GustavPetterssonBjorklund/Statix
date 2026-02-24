<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import statixFullLogo from "$lib/assets/staticsFull.svg";

  let token = "";
  let password = "";
  let confirmPassword = "";
  let errorMessage = "";
  let successMessage = "";
  let isSubmitting = false;

  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get("token");
    if (tokenFromUrl) {
      token = tokenFromUrl;
    }
  });

  async function submitSetPassword() {
    errorMessage = "";
    successMessage = "";

    if (!token.trim()) {
      errorMessage = "Token is required";
      return;
    }

    if (!password) {
      errorMessage = "Password is required";
      return;
    }

    if (password !== confirmPassword) {
      errorMessage = "Passwords do not match";
      return;
    }

    isSubmitting = true;
    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: token.trim(),
          password
        })
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      if (!response.ok) {
        errorMessage = data?.error ?? "Unable to set password";
        return;
      }

      successMessage = "Password set successfully. Redirecting to login...";
      setTimeout(() => {
        void goto("/login");
      }, 800);
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
    <h1 class="mb-1 text-center text-2xl font-semibold text-zinc-900">Set Password</h1>
    <p class="mb-6 text-center text-sm text-zinc-600">Use your invite/setup token to activate your account.</p>

    <form class="space-y-4" on:submit|preventDefault={submitSetPassword}>
      <label class="block">
        <span class="mb-1 block text-sm text-zinc-700">Setup token</span>
        <textarea
          class="h-24 w-full rounded border-zinc-300 font-mono text-xs"
          bind:value={token}
          placeholder="Paste setup token"
          required
        ></textarea>
      </label>

      <label class="block">
        <span class="mb-1 block text-sm text-zinc-700">New password</span>
        <input class="w-full rounded border-zinc-300" type="password" bind:value={password} required />
      </label>

      <label class="block">
        <span class="mb-1 block text-sm text-zinc-700">Confirm password</span>
        <input class="w-full rounded border-zinc-300" type="password" bind:value={confirmPassword} required />
      </label>

      {#if errorMessage}
        <p class="text-sm text-red-600">{errorMessage}</p>
      {/if}
      {#if successMessage}
        <p class="text-sm text-emerald-700">{successMessage}</p>
      {/if}

      <button
        class="w-full rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800 disabled:opacity-60"
        type="submit"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Setting password..." : "Set password"}
      </button>
    </form>
  </section>
</main>
