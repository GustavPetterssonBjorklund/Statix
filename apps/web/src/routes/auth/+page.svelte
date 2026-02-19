<script lang="ts">
  import { Card } from "$lib";

  type ApiResult = {
    status: number;
    body: unknown;
  };

  let bearerToken = "";
  let bootstrapStatus = "";
  let bootstrapStatusLoading = false;

  let claimToken = "";
  let claimEmail = "";
  let claimPassword = "";
  let claimDisplayName = "Admin";
  let claimResult = "";

  let loginEmail = "";
  let loginPassword = "";
  let loginResult = "";

  let meResult = "";
  let logoutResult = "";

  let createUserEmail = "";
  let createUserDisplayName = "";
  let createUserResult = "";

  let setPasswordToken = "";
  let setPasswordValue = "";
  let setPasswordResult = "";

  async function apiRequest(path: string, method: "GET" | "POST", body?: Record<string, unknown>) {
    const headers: Record<string, string> = {};

    if (bearerToken.trim().length > 0) {
      headers.authorization = `Bearer ${bearerToken.trim()}`;
    }
    if (body) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(`/api/auth/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    const result: ApiResult = {
      status: response.status,
      body: parsed,
    };
    return result;
  }

  function formatResult(label: string, value: ApiResult) {
    return `${label}\n${JSON.stringify(value, null, 2)}`;
  }

  async function checkBootstrapStatus() {
    bootstrapStatusLoading = true;
    try {
      const result = await apiRequest("bootstrap/status", "GET");
      bootstrapStatus = formatResult("Bootstrap status", result);
    } catch (error) {
      bootstrapStatus = `Bootstrap status\n${String(error)}`;
    } finally {
      bootstrapStatusLoading = false;
    }
  }

  async function claimBootstrap() {
    const result = await apiRequest("bootstrap/claim", "POST", {
      token: claimToken,
      email: claimEmail,
      password: claimPassword,
      displayName: claimDisplayName
    });
    claimResult = formatResult("Bootstrap claim", result);
  }

  async function login() {
    const result = await apiRequest("login", "POST", {
      email: loginEmail,
      password: loginPassword
    });
    loginResult = formatResult("Login", result);

    if (
      result.status === 200 &&
      result.body &&
      typeof result.body === "object" &&
      "token" in result.body &&
      typeof (result.body as { token?: unknown }).token === "string"
    ) {
      bearerToken = (result.body as { token: string }).token;
    }
  }

  async function me() {
    const result = await apiRequest("me", "GET");
    meResult = formatResult("Me", result);
  }

  async function logout() {
    const result = await apiRequest("logout", "POST");
    logoutResult = formatResult("Logout", result);
  }

  async function createUser() {
    const result = await apiRequest("users", "POST", {
      email: createUserEmail,
      displayName: createUserDisplayName
    });
    createUserResult = formatResult("Create user", result);
  }

  async function setPassword() {
    const result = await apiRequest("set-password", "POST", {
      token: setPasswordToken,
      password: setPasswordValue
    });
    setPasswordResult = formatResult("Set password", result);
  }
</script>

<main class="mx-auto max-w-6xl space-y-6 p-6">
  <header class="space-y-2">
    <h1 class="text-3xl font-bold text-zinc-900">Auth Test Console</h1>
    <p class="text-zinc-600">
      Use this page to test bootstrap, login, session, and admin user creation against your API auth routes.
    </p>
  </header>

  <Card title="1. Bootstrap Admin" subtitle="Check bootstrap state and claim the initial admin account.">
    <div class="grid gap-4 md:grid-cols-2">
      <div class="space-y-3">
        <button
          class="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800 disabled:opacity-60"
          on:click={checkBootstrapStatus}
          disabled={bootstrapStatusLoading}
        >
          {bootstrapStatusLoading ? "Checking..." : "Check bootstrap status"}
        </button>

        <input class="w-full rounded border-zinc-300" placeholder="Bootstrap token" bind:value={claimToken} />
        <input class="w-full rounded border-zinc-300" placeholder="Admin email" bind:value={claimEmail} />
        <input
          class="w-full rounded border-zinc-300"
          placeholder="Admin password"
          type="password"
          bind:value={claimPassword}
        />
        <input class="w-full rounded border-zinc-300" placeholder="Display name" bind:value={claimDisplayName} />
        <button class="rounded bg-blue-700 px-4 py-2 text-white hover:bg-blue-600" on:click={claimBootstrap}>
          Claim bootstrap token
        </button>
      </div>

      <div class="space-y-3">
        <pre class="min-h-32 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{bootstrapStatus}</pre>
        <pre class="min-h-48 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{claimResult}</pre>
      </div>
    </div>
  </Card>

  <Card title="2. Login & Session" subtitle="Authenticate and reuse the bearer token for protected endpoints.">
    <div class="grid gap-4 md:grid-cols-2">
      <div class="space-y-3">
        <input class="w-full rounded border-zinc-300" placeholder="Email" bind:value={loginEmail} />
        <input class="w-full rounded border-zinc-300" placeholder="Password" type="password" bind:value={loginPassword} />
        <button class="rounded bg-emerald-700 px-4 py-2 text-white hover:bg-emerald-600" on:click={login}>
          Login
        </button>

        <textarea
          class="h-24 w-full rounded border-zinc-300 font-mono text-xs"
          placeholder="Bearer token"
          bind:value={bearerToken}
        ></textarea>
        <div class="flex gap-2">
          <button class="rounded bg-zinc-700 px-4 py-2 text-white hover:bg-zinc-600" on:click={me}>Call /auth/me</button>
          <button class="rounded bg-red-700 px-4 py-2 text-white hover:bg-red-600" on:click={logout}>
            Logout
          </button>
        </div>
      </div>

      <div class="space-y-3">
        <pre class="min-h-32 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{loginResult}</pre>
        <pre class="min-h-24 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{meResult}</pre>
        <pre class="min-h-24 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{logoutResult}</pre>
      </div>
    </div>
  </Card>

  <Card title="3. Admin User Creation" subtitle="Create allowed accounts (admin token required).">
    <div class="grid gap-4 md:grid-cols-2">
      <div class="space-y-3">
        <input class="w-full rounded border-zinc-300" placeholder="New user email" bind:value={createUserEmail} />
        <input
          class="w-full rounded border-zinc-300"
          placeholder="Display name (optional)"
          bind:value={createUserDisplayName}
        />
        <button class="rounded bg-violet-700 px-4 py-2 text-white hover:bg-violet-600" on:click={createUser}>
          Create user + setup token
        </button>
      </div>
      <pre class="min-h-40 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{createUserResult}</pre>
    </div>
  </Card>

  <Card title="4. Set Password" subtitle="Use setup/reset token to set a password for an invited account.">
    <div class="grid gap-4 md:grid-cols-2">
      <div class="space-y-3">
        <textarea
          class="h-24 w-full rounded border-zinc-300 font-mono text-xs"
          placeholder="Setup/reset token"
          bind:value={setPasswordToken}
        ></textarea>
        <input
          class="w-full rounded border-zinc-300"
          placeholder="New password"
          type="password"
          bind:value={setPasswordValue}
        />
        <button class="rounded bg-amber-700 px-4 py-2 text-white hover:bg-amber-600" on:click={setPassword}>
          Set password
        </button>
      </div>
      <pre class="min-h-40 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{setPasswordResult}</pre>
    </div>
  </Card>
</main>
