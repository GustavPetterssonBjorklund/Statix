<script lang="ts">
	import { page } from "$app/state";
	import statixLogo from "$lib/assets/staticsFull.svg";
	import type { DrawerLink } from "$lib/config/drawer";

	type Props = {
		title?: string;
		links: DrawerLink[];
	};

	let { title = "Navigate", links }: Props = $props();

	const pathname = $derived(page.url.pathname);

	function isActiveLink(href: string) {
		return pathname === href || pathname.startsWith(`${href}/`);
	}
</script>

<aside class="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-zinc-200 bg-white px-4 py-5 shadow-sm md:flex">
	<div class="mb-6 flex items-center gap-3 px-2">
		<img src={statixLogo} alt="Statix logo" />
	</div>

	<p class="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
	<nav class="space-y-1">
		{#each links as link (link.href)}
			{@const Icon = link.icon}
			{@const active = isActiveLink(link.href)}
			<a
				class={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
					active ? "bg-zinc-900 text-white" : "text-zinc-800 hover:bg-zinc-100"
				}`}
				href={link.href}
				aria-current={active ? "page" : undefined}
			>
				<Icon class={`h-4 w-4 ${active ? "text-zinc-100" : "text-zinc-500"}`} />
				{link.label}
			</a>
		{/each}
	</nav>
</aside>
