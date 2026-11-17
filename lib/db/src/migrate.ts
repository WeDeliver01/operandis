import { createDb, runMigrations } from "./index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const handle = createDb(url, { max: 1, ssl: process.env.DATABASE_SSL === "true" });
runMigrations(handle.db)
  .then(async () => {
    console.log("migrations applied");
    await handle.close();
  })
  .catch(async (err) => {
    console.error(err);
    await handle.close();
    process.exit(1);
  });
