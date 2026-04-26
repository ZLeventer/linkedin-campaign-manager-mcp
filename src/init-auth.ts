#!/usr/bin/env node
import { runInitFlow } from "./auth.js";

runInitFlow().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
