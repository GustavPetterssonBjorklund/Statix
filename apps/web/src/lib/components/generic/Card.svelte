<script lang="ts">
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	type PaddingSize = "sm" | "md" | "lg";

	type Props = HTMLAttributes<HTMLDivElement> & {
		title?: string;
		subtitle?: string;
		interactive?: boolean;
		padding?: PaddingSize;
		header?: Snippet;
		children?: Snippet;
		footer?: Snippet;
		class?: string;
	};

	let {
		title,
		subtitle,
		interactive = false,
		padding = "md",
		header,
		children,
		footer,
		class: className = "",
		...restProps
	}: Props = $props();

	const paddingClassMap: Record<PaddingSize, string> = {
		sm: "p-3",
		md: "p-5",
		lg: "p-7"
	};

	const bodyPaddingClass = $derived(paddingClassMap[padding]);
	const cardClass = $derived(
		[
			"rounded-2xl border border-zinc-200 bg-white shadow-sm",
			interactive ? "transition hover:-translate-y-0.5 hover:shadow-md" : "",
			className
		]
			.filter(Boolean)
			.join(" ")
	);
</script>

<div {...restProps} class={cardClass}>
	{#if title || subtitle || header}
		<header class="border-b border-zinc-100 px-5 py-4">
			{@render header?.()}

			{#if title}
				<h3 class="text-base font-semibold text-zinc-900">{title}</h3>
			{/if}

			{#if subtitle}
				<p class="mt-1 text-sm text-zinc-600">{subtitle}</p>
			{/if}
		</header>
	{/if}

	<div class={bodyPaddingClass}>
		{@render children?.()}
	</div>

	{#if footer}
		<footer class="border-t border-zinc-100 px-5 py-4">
			{@render footer()}
		</footer>
	{/if}
</div>
