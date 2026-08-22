import test from "node:test";
import assert from "node:assert/strict";

const api = process.env.TEST_API_URL;

test("concurrent seat holds have one winner", async (t) => {
  if (!api) {
    t.skip("Set TEST_API_URL to a running seeded API to run integration tests");
    return;
  }
  const register = async (email: string) => {
    const response = await fetch(`${api}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: email.split("@")[0], email, password: "ConcurrentPass123!" }),
    });
    return (await response.json()) as { token: string };
  };
  const [a, b] = await Promise.all([register(`a-${Date.now()}@test.local`), register(`b-${Date.now()}@test.local`)]);
  const events = await (await fetch(`${api}/events`)).json() as Array<{ id: string }>;
  const seats = await (await fetch(`${api}/events/${events[0].id}/seats`)).json() as Array<{ id: string }>;
  const request = (token: string) => fetch(`${api}/events/${events[0].id}/holds`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ seatIds: [seats[0].id] }),
  });
  const responses = await Promise.all([request(a.token), request(b.token)]);
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => response.status === 409).length, 1);
});
