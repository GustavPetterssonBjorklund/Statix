<script lang="ts">
	import { scaleLinear, scaleTime } from "d3-scale";
	import { curveMonotoneX, line, area } from "d3-shape";

	type LineChart = {
		path: string;
		secondaryPath: string;
		areaPath: string;
		xTicks: Array<{ x: number; label: string }>;
		yTicks: Array<{ y: number; label: string; value: number }>;
		plotTop: number;
		plotBottom: number;
		plotLeft: number;
		plotRight: number;
		lastX: number;
		lastY: number;
		lastValue: number | null;
		secondaryLastX: number;
		secondaryLastY: number;
		secondaryLastValue: number | null;
	};

	let {
		title,
		values,
		timestamps,
		stroke,
		yDomain,
		width = 760,
		height = 220,
		seriesLabel,
		secondaryValues = [],
		secondaryStroke,
		secondaryLabel
	} =
		$props<{
			title: string;
			values: number[];
			timestamps: number[];
			stroke: string;
			yDomain?: [number, number];
			width?: number;
			height?: number;
			seriesLabel?: string;
			secondaryValues?: number[];
			secondaryStroke?: string;
			secondaryLabel?: string;
		}>();

	function isPercentDomain(domain?: [number, number]) {
		if (!Array.isArray(domain) || domain.length !== 2) return false;
		const lo = Math.min(domain[0], domain[1]);
		const hi = Math.max(domain[0], domain[1]);
		return lo === 0 && hi === 100;
	}

	function formatY(value: number, domain?: [number, number]) {
		if (isPercentDomain(domain)) return `${value.toFixed(0)}%`;

		// You can tweak this if you want decimals for small ranges.
		const abs = Math.abs(value);
		if (abs >= 1000) return value.toFixed(0);
		if (abs >= 100) return value.toFixed(0);
		if (abs >= 10) return value.toFixed(1);
		return value.toFixed(2);
	}

	function formatTimeLabel(d: Date) {
		// Keep it compact and consistent
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}

	function buildLineChart(
		seriesValues: number[],
		seriesValuesSecondary: number[],
		seriesTimes: number[],
		chartWidth: number,
		chartHeight: number,
		fixedYDomain?: [number, number]
	): LineChart {
		const margin = {
			top: 10,
			right: 14,
			bottom: 48, // more room for x labels
			left: 56, // more room for y labels
		};

		const plotWidth = Math.max(1, chartWidth - margin.left - margin.right);
		const plotHeight = Math.max(1, chartHeight - margin.top - margin.bottom);

		if (seriesValues.length === 0 || seriesTimes.length === 0) {
			return {
				path: "",
				secondaryPath: "",
				areaPath: "",
				xTicks: [],
				yTicks: [],
				plotTop: margin.top,
				plotBottom: margin.top + plotHeight,
				plotLeft: margin.left,
				plotRight: margin.left + plotWidth,
				lastX: margin.left,
				lastY: margin.top + plotHeight,
				lastValue: null,
				secondaryLastX: margin.left,
				secondaryLastY: margin.top + plotHeight,
				secondaryLastValue: null,
			};
		}

		let safeValues = seriesValues;
		let safeSecondaryValues = seriesValuesSecondary;
		let safeTimes = seriesTimes;

		// ensure we can draw a line even with one point
		if (safeValues.length === 1) {
			safeValues = [safeValues[0], safeValues[0]];
			const t = safeTimes[0] ?? Date.now();
			safeTimes = [t - 1000, t];
			if (safeSecondaryValues.length === 1) {
				safeSecondaryValues = [safeSecondaryValues[0], safeSecondaryValues[0]];
			}
		}

		const minTime = Math.min(...safeTimes);
		const maxTime = Math.max(...safeTimes);
		const paddedMaxTime = maxTime === minTime ? maxTime + 1000 : maxTime;

		const xScale = scaleTime()
			.domain([new Date(minTime), new Date(paddedMaxTime)])
			.range([margin.left, margin.left + plotWidth]);

		const computedYDomain: [number, number] =
			Array.isArray(fixedYDomain) && fixedYDomain.length === 2
				? [Math.min(fixedYDomain[0], fixedYDomain[1]), Math.max(fixedYDomain[0], fixedYDomain[1])]
				: [
					Math.min(...safeValues, ...(safeSecondaryValues.length > 0 ? safeSecondaryValues : [])),
					Math.max(...safeValues, ...(safeSecondaryValues.length > 0 ? safeSecondaryValues : [])),
				];

		// Avoid flatline domain
		if (computedYDomain[0] === computedYDomain[1]) {
			const v = computedYDomain[0];
			computedYDomain[0] = v - 1;
			computedYDomain[1] = v + 1;
		}

		const yScale = scaleLinear()
			.domain(computedYDomain)
			.range([margin.top + plotHeight, margin.top])
			.nice();

		const tickCountX = chartWidth < 420 ? 3 : chartWidth < 700 ? 5 : 6;
		const tickCountY = chartWidth < 420 ? 4 : 5;

		const yTicks = yScale.ticks(tickCountY).map((tick) => ({
			y: yScale(tick),
			value: tick,
			label: formatY(tick, fixedYDomain),
		}));

		const xTicks = xScale.ticks(tickCountX).map((tick) => ({
			x: xScale(tick),
			label: formatTimeLabel(tick),
		}));

		const lineGen = line<number>()
			.x((_, i) => xScale(new Date(safeTimes[i] ?? paddedMaxTime)))
			.y((v) => yScale(v))
			.curve(curveMonotoneX);

		const areaGen = area<number>()
			.x((_, i) => xScale(new Date(safeTimes[i] ?? paddedMaxTime)))
			.y0(margin.top + plotHeight)
			.y1((v) => yScale(v))
			.curve(curveMonotoneX);

		const lastIndex = Math.max(0, seriesValues.length - 1);
		const lastValue = seriesValues[lastIndex] ?? null;
		const lastTime = seriesTimes[lastIndex] ?? paddedMaxTime;
		const secondaryLastIndex = Math.max(0, seriesValuesSecondary.length - 1);
		const secondaryLastValue = seriesValuesSecondary[secondaryLastIndex] ?? null;
		const secondaryLastTime = seriesTimes[secondaryLastIndex] ?? paddedMaxTime;

		return {
			path: lineGen(safeValues) ?? "",
			secondaryPath: safeSecondaryValues.length > 0 ? (lineGen(safeSecondaryValues) ?? "") : "",
			areaPath: areaGen(safeValues) ?? "",
			xTicks,
			yTicks,
			plotTop: margin.top,
			plotBottom: margin.top + plotHeight,
			plotLeft: margin.left,
			plotRight: margin.left + plotWidth,
			lastX: xScale(new Date(lastTime)),
			lastY: lastValue == null ? margin.top + plotHeight : yScale(lastValue),
			lastValue,
			secondaryLastX: xScale(new Date(secondaryLastTime)),
			secondaryLastY: secondaryLastValue == null ? margin.top + plotHeight : yScale(secondaryLastValue),
			secondaryLastValue,
		};
	}

	function summarizeSeries(seriesValues: number[]) {
		if (seriesValues.length === 0) return { min: 0, max: 0, avg: 0 };
		const min = Math.min(...seriesValues);
		const max = Math.max(...seriesValues);
		const avg = seriesValues.reduce((t, v) => t + v, 0) / seriesValues.length;
		return { min, max, avg };
	}

	const chart = $derived(buildLineChart(values, secondaryValues, timestamps, width, height, yDomain));
	const summary = $derived(summarizeSeries(values));
	const secondarySummary = $derived(summarizeSeries(secondaryValues));
	const gradientId = $derived(`line-gradient-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
	const isPct = $derived(isPercentDomain(yDomain));
	const primaryLegendLabel = $derived(seriesLabel ?? title);
	const lastLabel = $derived(
		chart.lastValue == null ? "—" : isPct ? `${chart.lastValue.toFixed(0)}%` : formatY(chart.lastValue, yDomain)
	);
	const secondaryLastLabel = $derived(
		chart.secondaryLastValue == null
			? "—"
			: isPct
				? `${chart.secondaryLastValue.toFixed(0)}%`
				: formatY(chart.secondaryLastValue, yDomain)
	);
</script>

<div class="rounded-xl border border-zinc-200/70 bg-white p-3 shadow-sm">
	<!-- Header -->
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div class="flex items-center gap-2">
			<span class="h-2.5 w-2.5 rounded-full" style={`background:${stroke}`}></span>
			<p class="text-sm font-semibold text-zinc-900">{title}</p>
		</div>

		<!-- Quick stats -->
		<div class="flex flex-wrap items-center gap-2 text-xs text-zinc-700">
			<span class="rounded-md bg-zinc-50 px-2 py-1 tabular-nums">min {formatY(summary.min, yDomain)}</span>
			<span class="rounded-md bg-zinc-50 px-2 py-1 tabular-nums">avg {formatY(summary.avg, yDomain)}</span>
			<span class="rounded-md bg-zinc-50 px-2 py-1 tabular-nums">max {formatY(summary.max, yDomain)}</span>
		</div>
	</div>

	<!-- Chart -->
	<svg viewBox={`0 0 ${width} ${height}`} class="mt-2 h-48 w-full">
		<defs>
			<linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
				<stop offset="0%" stop-color={stroke} stop-opacity="0.35" />
				<stop offset="100%" stop-color={stroke} stop-opacity="1" />
			</linearGradient>

			<linearGradient id={`${gradientId}-area`} x1="0%" y1="0%" x2="0%" y2="100%">
				<stop offset="0%" stop-color={stroke} stop-opacity="0.18" />
				<stop offset="100%" stop-color={stroke} stop-opacity="0" />
			</linearGradient>
		</defs>

		<!-- Grid (Y) -->
		{#each chart.yTicks as tick}
			<line
				x1={chart.plotLeft}
				y1={tick.y}
				x2={chart.plotRight}
				y2={tick.y}
				stroke="#e4e4e7"
				stroke-width={tick.value === 0 ? 1.5 : 1}
			/>
			<text
				x={chart.plotLeft - 10}
				y={tick.y + 4}
				text-anchor="end"
				class="fill-zinc-600 text-[11px] font-medium tabular-nums"
			>
				{tick.label}
			</text>
		{/each}

		<!-- X axis baseline -->
		<line
			x1={chart.plotLeft}
			y1={chart.plotBottom}
			x2={chart.plotRight}
			y2={chart.plotBottom}
			stroke="#a1a1aa"
			stroke-width="1"
		/>

		<!-- Y axis baseline -->
		<line
			x1={chart.plotLeft}
			y1={chart.plotTop}
			x2={chart.plotLeft}
			y2={chart.plotBottom}
			stroke="#a1a1aa"
			stroke-width="1"
		/>

		<!-- X ticks + labels -->
		{#each chart.xTicks as tick}
			<line
				x1={tick.x}
				y1={chart.plotBottom}
				x2={tick.x}
				y2={chart.plotBottom + 5}
				stroke="#a1a1aa"
				stroke-width="1"
			/>
			<text
				x={tick.x}
				y={chart.plotBottom + 20}
				text-anchor="middle"
				class="fill-zinc-600 text-[11px] font-medium tabular-nums"
			>
				{tick.label}
			</text>
		{/each}

		<!-- Area under curve (subtle, improves readability) -->
		<path d={chart.areaPath} fill={`url(#${gradientId}-area)`} />

		<!-- Line -->
		<path d={chart.path} fill="none" stroke={`url(#${gradientId})`} stroke-width="2.75" />
		{#if chart.secondaryPath && secondaryStroke}
			<path d={chart.secondaryPath} fill="none" stroke={secondaryStroke} stroke-width="2.25" />
		{/if}

		<!-- Last point marker -->
		{#if chart.lastValue !== null}
			<circle cx={chart.lastX} cy={chart.lastY} r="3.5" fill={stroke} />
			<circle cx={chart.lastX} cy={chart.lastY} r="7" fill={stroke} opacity="0.12" />
		{/if}
		{#if chart.secondaryLastValue !== null && secondaryStroke}
			<circle cx={chart.secondaryLastX} cy={chart.secondaryLastY} r="3" fill={secondaryStroke} />
		{/if}
	</svg>

	<!-- Legend / info bottom (priority: information) -->
	<div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-700">
		<div class="flex items-center gap-2">
			<span class="h-2.5 w-6 rounded-sm" style={`background:${stroke}`}></span>
			<span class="font-medium text-zinc-800">{primaryLegendLabel}</span>
			{#if secondaryStroke && secondaryLabel}
				<span class="ml-2 h-2.5 w-6 rounded-sm" style={`background:${secondaryStroke}`}></span>
				<span class="font-medium text-zinc-800">{secondaryLabel}</span>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-3 tabular-nums">
			<span class="text-zinc-600">{primaryLegendLabel}</span>
			<span class="rounded-md bg-zinc-50 px-2 py-1 font-semibold text-zinc-900">{lastLabel}</span>
			<span class="text-zinc-500">
				range {formatY(summary.min, yDomain)}–{formatY(summary.max, yDomain)}
			</span>
			{#if secondaryStroke && secondaryLabel}
				<span class="text-zinc-600">{secondaryLabel}</span>
				<span class="rounded-md bg-zinc-50 px-2 py-1 font-semibold text-zinc-900">{secondaryLastLabel}</span>
				<span class="text-zinc-500">
					range {formatY(secondarySummary.min, yDomain)}–{formatY(secondarySummary.max, yDomain)}
				</span>
			{/if}
		</div>
	</div>
</div>
