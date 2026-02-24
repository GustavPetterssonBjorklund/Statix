<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import NavDrawer from "$lib/components/generic/NavDrawer.svelte";
	import { clearAuthToken, getAuthToken, validateAuthToken } from "$lib/auth";
	import { drawerLinks, drawerTitles } from "$lib/config/drawer";

	type AuthUser = {
		id: string;
		email: string;
		displayName: string | null;
		roles: string[];
	};

	type UserRow = {
		id: string;
		email: string;
		displayName: string | null;
		isDisabled: boolean;
		createdAt: string;
		lastLoginAt: string | null;
		roles: string[];
	};

	type PermissionRow = {
		id: string;
		code: string;
		description: string | null;
	};

	type RoleRow = {
		id: string;
		name: string;
		description: string | null;
		usersCount: number;
		permissions: Array<{
			code: string;
			description: string | null;
		}>;
	};

	let loading = true;
	let errorMessage = "";
	let authToken = "";
	let currentUser: AuthUser | null = null;
	let users: UserRow[] = [];
	let roles: RoleRow[] = [];
	let permissions: PermissionRow[] = [];
	let searchTerm = "";

	let draftUserRoles: Record<string, string[]> = {};
	let draftRolePermissions: Record<string, string[]> = {};
	let savingUserRoleState: Record<string, boolean> = {};
	let savingRolePolicyState: Record<string, boolean> = {};

	let inviteEmail = "";
	let inviteDisplayName = "";
	let inviteBusy = false;
	let inviteError = "";
	let inviteResult = "";

	let newRoleName = "";
	let newRoleDescription = "";
	let newRolePermissionCodes: string[] = [];
	let newRoleBusy = false;
	let newRoleError = "";

	function parseJsonSafe(text: string) {
		if (!text) {
			return null;
		}

		try {
			return JSON.parse(text) as Record<string, unknown>;
		} catch {
			return null;
		}
	}

	async function fetchAuth(path: string, init?: RequestInit) {
		const response = await fetch(`/api/auth/${path}`, {
			...init,
			headers: {
				...(init?.headers ?? {}),
				authorization: `Bearer ${authToken}`
			}
		});

		const text = await response.text();
		const data = parseJsonSafe(text);
		return { response, data, rawText: text };
	}

	function setUserSaving(userId: string, value: boolean) {
		savingUserRoleState = { ...savingUserRoleState, [userId]: value };
	}

	function setRoleSaving(roleName: string, value: boolean) {
		savingRolePolicyState = { ...savingRolePolicyState, [roleName]: value };
	}

	function toggleDraftUserRole(userId: string, roleName: string, checked: boolean) {
		const current = new Set(draftUserRoles[userId] ?? []);
		if (checked) {
			current.add(roleName);
		} else {
			current.delete(roleName);
		}
		draftUserRoles = { ...draftUserRoles, [userId]: [...current] };
	}

	function toggleDraftRolePermission(roleName: string, permissionCode: string, checked: boolean) {
		const current = new Set(draftRolePermissions[roleName] ?? []);
		if (checked) {
			current.add(permissionCode);
		} else {
			current.delete(permissionCode);
		}
		draftRolePermissions = { ...draftRolePermissions, [roleName]: [...current] };
	}

	function toggleNewRolePermission(permissionCode: string, checked: boolean) {
		const next = new Set(newRolePermissionCodes);
		if (checked) {
			next.add(permissionCode);
		} else {
			next.delete(permissionCode);
		}
		newRolePermissionCodes = [...next];
	}

	async function loadAccessData() {
		const [usersResult, rolesResult, permissionsResult] = await Promise.all([
			fetchAuth("users", { method: "GET" }),
			fetchAuth("roles", { method: "GET" }),
			fetchAuth("permissions", { method: "GET" })
		]);

		const errors: string[] = [];
		if (!usersResult.response.ok) {
			errors.push("users");
		}
		if (!rolesResult.response.ok) {
			errors.push("roles");
		}
		if (!permissionsResult.response.ok) {
			errors.push("permissions");
		}
		if (errors.length > 0) {
			throw new Error(`Failed loading: ${errors.join(", ")}`);
		}

		users = Array.isArray(usersResult.data?.users) ? (usersResult.data?.users as UserRow[]) : [];
		roles = Array.isArray(rolesResult.data?.roles) ? (rolesResult.data?.roles as RoleRow[]) : [];
		permissions = Array.isArray(permissionsResult.data?.permissions)
			? (permissionsResult.data?.permissions as PermissionRow[])
			: [];

		draftUserRoles = Object.fromEntries(users.map((user) => [user.id, [...user.roles]]));
		draftRolePermissions = Object.fromEntries(
			roles.map((role) => [role.name, role.permissions.map((permission) => permission.code)])
		);
	}

	async function saveUserRoles(user: UserRow) {
		const roleNames = draftUserRoles[user.id] ?? [];
		if (roleNames.length === 0) {
			errorMessage = "A user must have at least one role.";
			return;
		}

		setUserSaving(user.id, true);
		errorMessage = "";
		try {
			const result = await fetchAuth(`users/${encodeURIComponent(user.id)}/roles`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ roleNames })
			});

			if (!result.response.ok) {
				errorMessage = (result.data?.error as string) ?? "Failed to update user roles";
				return;
			}

			await loadAccessData();
		} catch {
			errorMessage = "Unable to update user roles";
		} finally {
			setUserSaving(user.id, false);
		}
	}

	async function saveRolePolicy(role: RoleRow) {
		const permissionCodes = draftRolePermissions[role.name] ?? [];
		setRoleSaving(role.name, true);
		errorMessage = "";
		try {
			const result = await fetchAuth(`roles/${encodeURIComponent(role.name)}/permissions`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ permissionCodes })
			});

			if (!result.response.ok) {
				errorMessage = (result.data?.error as string) ?? "Failed to update role policy";
				return;
			}

			await loadAccessData();
		} catch {
			errorMessage = "Unable to update role policy";
		} finally {
			setRoleSaving(role.name, false);
		}
	}

	async function createRole() {
		newRoleError = "";
		const roleName = newRoleName.trim().toLowerCase();
		if (!roleName) {
			newRoleError = "Role name is required";
			return;
		}

		newRoleBusy = true;
		try {
			const result = await fetchAuth("roles", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: roleName,
					description: newRoleDescription.trim(),
					permissionCodes: newRolePermissionCodes
				})
			});

			if (!result.response.ok) {
				newRoleError = (result.data?.error as string) ?? "Failed to create role";
				return;
			}

			newRoleName = "";
			newRoleDescription = "";
			newRolePermissionCodes = [];
			await loadAccessData();
		} catch {
			newRoleError = "Unable to create role";
		} finally {
			newRoleBusy = false;
		}
	}

	async function inviteUser() {
		inviteBusy = true;
		inviteError = "";
		inviteResult = "";

		try {
			const result = await fetchAuth("users", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: inviteEmail.trim(),
					displayName: inviteDisplayName.trim()
				})
			});

			if (!result.response.ok) {
				inviteError = (result.data?.error as string) ?? "Failed to invite user";
				return;
			}

			const setupToken = typeof result.data?.setupToken === "string" ? result.data.setupToken : "";
			const setupUrl = setupToken ? `${window.location.origin}/set-password?token=${encodeURIComponent(setupToken)}` : "";
			inviteResult = setupToken
				? `Setup URL:\n${setupUrl}\n\nSetup token:\n${setupToken}`
				: "User invited successfully (no setup token returned).";
			inviteEmail = "";
			inviteDisplayName = "";
			await loadAccessData();
		} catch {
			inviteError = "Unable to invite user";
		} finally {
			inviteBusy = false;
		}
	}

	$: filteredUsers = users.filter((user) => {
		const term = searchTerm.trim().toLowerCase();
		if (!term) {
			return true;
		}
		return (
			user.email.toLowerCase().includes(term) ||
			(user.displayName ?? "").toLowerCase().includes(term) ||
			user.roles.some((role) => role.toLowerCase().includes(term))
		);
	});

	onMount(() => {
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

			currentUser = authUser as AuthUser;
			if (!currentUser.roles.includes("admin")) {
				await goto("/dashboard");
				return;
			}

			try {
				await loadAccessData();
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : "Failed to load access data";
			} finally {
				loading = false;
			}
		})();
	});
</script>

<main class="mx-auto max-w-7xl space-y-6 p-6 pl-72">
	<NavDrawer title={drawerTitles.users} links={drawerLinks} />

	<header class="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
		<h1 class="text-2xl font-bold text-zinc-900">User Management</h1>
		<p class="mt-1 text-sm text-zinc-600">
			Manage users, roles, and role policies (permission groups) from one tab.
		</p>
	</header>

	{#if errorMessage}
		<div class="rounded-md bg-red-50 p-4 text-sm font-medium text-red-800">{errorMessage}</div>
	{/if}

	{#if loading}
		<div class="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">Loading access data...</div>
	{:else}
		<section class="grid grid-cols-1 gap-4 lg:grid-cols-3">
			<article class="rounded-xl border border-zinc-200 bg-white p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Users</p>
				<p class="mt-1 text-2xl font-bold text-zinc-900">{users.length}</p>
			</article>
			<article class="rounded-xl border border-zinc-200 bg-white p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Roles</p>
				<p class="mt-1 text-2xl font-bold text-zinc-900">{roles.length}</p>
			</article>
			<article class="rounded-xl border border-zinc-200 bg-white p-4">
				<p class="text-xs font-semibold uppercase tracking-wide text-zinc-500">Policies</p>
				<p class="mt-1 text-2xl font-bold text-zinc-900">{permissions.length}</p>
			</article>
		</section>

		<section class="rounded-xl border border-zinc-200 bg-white p-4">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-600">Invite User</h2>
			<div class="mt-3 grid gap-3 md:grid-cols-3">
				<input class="rounded border-zinc-300 text-sm" placeholder="Email" bind:value={inviteEmail} />
				<input
					class="rounded border-zinc-300 text-sm"
					placeholder="Display name (optional)"
					bind:value={inviteDisplayName}
				/>
				<button class="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800" on:click={inviteUser} disabled={inviteBusy}>
					{inviteBusy ? "Inviting..." : "Invite User"}
				</button>
			</div>
			{#if inviteError}
				<p class="mt-2 text-sm text-red-600">{inviteError}</p>
			{/if}
			{#if inviteResult}
				<pre class="mt-2 overflow-auto rounded bg-zinc-900 p-3 text-xs text-zinc-100">{inviteResult}</pre>
			{/if}
		</section>

		<section class="rounded-xl border border-zinc-200 bg-white p-4">
			<h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-600">Users and Roles</h2>
			<input
				class="mt-3 w-full rounded border-zinc-300 text-sm"
				placeholder="Search by email, display name, or role..."
				bind:value={searchTerm}
			/>

			<div class="mt-4 space-y-3">
				{#if filteredUsers.length === 0}
					<p class="text-sm text-zinc-600">No users matched your search.</p>
				{:else}
					{#each filteredUsers as user (user.id)}
						<article class="rounded-lg border border-zinc-200 p-3">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<div>
									<p class="font-semibold text-zinc-900">{user.displayName ?? user.email}</p>
									<p class="text-xs text-zinc-500">{user.email}</p>
								</div>
								<button
									class="rounded border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
									on:click={() => saveUserRoles(user)}
									disabled={savingUserRoleState[user.id]}
								>
									{savingUserRoleState[user.id] ? "Saving..." : "Save Roles"}
								</button>
							</div>

							<div class="mt-3 grid gap-2 md:grid-cols-3">
								{#each roles as role (role.id)}
									<label class="flex items-center gap-2 text-sm text-zinc-700">
										<input
											type="checkbox"
											checked={(draftUserRoles[user.id] ?? []).includes(role.name)}
											on:change={(event) =>
												toggleDraftUserRole(user.id, role.name, (event.currentTarget as HTMLInputElement).checked)}
										/>
										{role.name}
									</label>
								{/each}
							</div>
						</article>
					{/each}
				{/if}
			</div>
		</section>

		<section class="grid gap-4 xl:grid-cols-2">
			<article class="rounded-xl border border-zinc-200 bg-white p-4">
				<h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-600">Create Role</h2>
				<div class="mt-3 space-y-3">
					<input class="w-full rounded border-zinc-300 text-sm" placeholder="role name (e.g. ops_manager)" bind:value={newRoleName} />
					<input class="w-full rounded border-zinc-300 text-sm" placeholder="description (optional)" bind:value={newRoleDescription} />
					<div class="max-h-56 overflow-auto rounded border border-zinc-200 p-2">
						{#each permissions as permission (permission.id)}
							<label class="flex items-start gap-2 py-1 text-sm text-zinc-700">
								<input
									type="checkbox"
									checked={newRolePermissionCodes.includes(permission.code)}
									on:change={(event) => toggleNewRolePermission(permission.code, (event.currentTarget as HTMLInputElement).checked)}
								/>
								<span>{permission.code}</span>
							</label>
						{/each}
					</div>
					<button
						class="rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
						on:click={createRole}
						disabled={newRoleBusy}
					>
						{newRoleBusy ? "Creating..." : "Create Role"}
					</button>
					{#if newRoleError}
						<p class="text-sm text-red-600">{newRoleError}</p>
					{/if}
				</div>
			</article>

			<article class="rounded-xl border border-zinc-200 bg-white p-4">
				<h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-600">Role Policies (Group Policies)</h2>
				<div class="mt-3 space-y-4">
					{#each roles as role (role.id)}
						<div class="rounded-lg border border-zinc-200 p-3">
							<div class="flex items-center justify-between gap-2">
								<div>
									<p class="font-semibold text-zinc-900">{role.name}</p>
									<p class="text-xs text-zinc-500">{role.description ?? "No description"}</p>
								</div>
								<button
									class="rounded border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
									on:click={() => saveRolePolicy(role)}
									disabled={savingRolePolicyState[role.name]}
								>
									{savingRolePolicyState[role.name] ? "Saving..." : "Save Policy"}
								</button>
							</div>
							<p class="mt-1 text-xs text-zinc-500">Users: {role.usersCount}</p>
							<div class="mt-2 grid gap-2 md:grid-cols-2">
								{#each permissions as permission (permission.id)}
									<label class="flex items-start gap-2 text-xs text-zinc-700">
										<input
											type="checkbox"
											checked={(draftRolePermissions[role.name] ?? []).includes(permission.code)}
											on:change={(event) =>
												toggleDraftRolePermission(
													role.name,
													permission.code,
													(event.currentTarget as HTMLInputElement).checked
												)}
										/>
										<span>{permission.code}</span>
									</label>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</article>
		</section>
	{/if}
</main>
