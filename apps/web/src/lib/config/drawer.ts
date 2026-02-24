import { CircleGauge, KeyRound, LogIn, Shield, Hexagon } from "lucide-svelte";

export type DrawerLink = {
	label: string;
	href: string;
	icon: typeof CircleGauge | typeof Shield | typeof KeyRound | typeof LogIn;
};

export const drawerLinks: DrawerLink[] = [
	{ label: "Dashboard", href: "/dashboard", icon: CircleGauge },
	{ label: "Nodes", href: "/nodes", icon: Hexagon },
	{ label: "Admin View", href: "/admin", icon: Shield },
	{ label: "Auth Console", href: "/auth", icon: KeyRound },
	{ label: "Login", href: "/login", icon: LogIn }
];
	
export const drawerTitles = {
	dashboard: "Quick Navigation",
	admin: "Admin Navigation"
} as const;
