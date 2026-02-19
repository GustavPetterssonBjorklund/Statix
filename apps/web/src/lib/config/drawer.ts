import type { ComponentType } from "svelte";
import { CircleGauge, KeyRound, LogIn, Shield } from "lucide-svelte";

export type DrawerLink = {
	label: string;
	href: string;
	icon: ComponentType;
};

export const drawerLinks: DrawerLink[] = [
	{ label: "Dashboard", href: "/dashboard", icon: CircleGauge },
	{ label: "Admin View", href: "/admin", icon: Shield },
	{ label: "Auth Console", href: "/auth", icon: KeyRound },
	{ label: "Login", href: "/login", icon: LogIn }
];

export const drawerTitles = {
	dashboard: "Quick Navigation",
	admin: "Admin Navigation"
} as const;
