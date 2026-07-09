import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "@/lib/env";

let database: ReturnType<typeof drizzle> | null = null;
let databaseUrl: string | null = null;

export function getDb() {
  if (!database || databaseUrl !== env.databaseUrl) {
    const client = createClient({
      url: env.databaseUrl,
    });

    database = drizzle(client);
    databaseUrl = env.databaseUrl;
  }

  return database;
}
