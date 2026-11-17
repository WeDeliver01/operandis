import { createDb, runMigrations } from "@workspace/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const handle = createDb(url, { max: 1, ssl: process.env.DATABASE_SSL === "true" });
runMigrations(handle.db)
  .then(() => console.log("migrations applied"))
  .finally(() => handle.close());
