import { pool } from "@workspace/db";
import bcrypt from "bcryptjs";

const client = await pool.connect();
try {
  await client.query("BEGIN");
  const passwords = await Promise.all(["AdminPass123!", "OrganiserPass123!", "CustomerPass123!"].map((p) => bcrypt.hash(p, 12)));
  const accounts = [
    ["Admin User", "admin@scenepass.demo", passwords[0], "ADMIN"],
    ["Maya Organiser", "organiser@scenepass.demo", passwords[1], "ORGANISER"],
    ["Ari Customer", "customer@scenepass.demo", passwords[2], "CUSTOMER"],
  ];
  for (const account of accounts) {
    await client.query(
      `INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role`,
      account,
    );
  }
  const organiser = (await client.query(`SELECT id FROM users WHERE email='organiser@scenepass.demo'`)).rows[0].id;
  const venueResult = await client.query(
    `INSERT INTO venues (name,address,city,capacity) VALUES ('Aurora Hall','18 Meridian Avenue','Bengaluru',0)
     ON CONFLICT DO NOTHING RETURNING id`,
  );
  const venue = venueResult.rows[0]?.id || (await client.query(`SELECT id FROM venues WHERE name='Aurora Hall' ORDER BY created_at LIMIT 1`)).rows[0].id;
  for (let row = 0; row < 8; row++) {
    for (let number = 1; number <= 12; number++) {
      await client.query(
        `INSERT INTO seats (venue_id,row,number,category,price) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (venue_id,row,number) DO NOTHING`,
        [venue, String.fromCharCode(65 + row), number, row < 2 ? "PREMIUM" : "STANDARD", row < 2 ? 28 : 18],
      );
    }
  }
  await client.query(`UPDATE venues SET capacity=(SELECT COUNT(*) FROM seats WHERE venue_id=$1) WHERE id=$1`, [venue]);
  const eventSeeds = [
    ["Neon Horizon", "MOVIE", "A midnight chase through a city that never sleeps.", "2026-09-18T19:30:00+05:30", 28, 18, "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80"],
    ["The Paper Kites · Live", "CONCERT", "An intimate night of luminous indie folk and close harmonies.", "2026-09-26T20:00:00+05:30", 42, 30, "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=80"],
    ["Midnight Matinee", "MOVIE", "A cult classic on the big screen, restored for one special showing.", "2026-10-04T16:00:00+05:30", 24, 16, "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=1200&q=80"],
  ];
  for (const seed of eventSeeds) {
    const existing = await client.query(`SELECT id FROM events WHERE title=$1 AND venue_id=$2`, [seed[0], venue]);
    const id = existing.rows[0]?.id || (await client.query(
      `INSERT INTO events (organiser_id,venue_id,title,category,description,starts_at,premium_price,standard_price,image_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [organiser, venue, ...seed],
    )).rows[0].id;
    await client.query(`INSERT INTO event_seats (event_id,seat_id) SELECT $1,id FROM seats WHERE venue_id=$2 ON CONFLICT DO NOTHING`, [id, venue]);
  }
  await client.query("COMMIT");
  console.log("ScenePass demo data seeded.");
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}