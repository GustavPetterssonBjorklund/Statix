import { runPrestart } from "./prestart/prestart.js";

await runPrestart();
await import("./app.js");
