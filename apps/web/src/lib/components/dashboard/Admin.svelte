<script lang="ts">
    import { Card } from "$lib";

    let { title, subtitle } = $props();
</script>
<Card title={title} subtitle={subtitle}>
    <slot />
</Card>