import { test, expect, type Page } from "@playwright/test";

/**
 * Durable chat history: the sidebar's History section used to be ten hardcoded titles in
 * localStorage on rows with no click handler. These cover the regression that mattered —
 * a conversation appears while it is happening, and reopening it restores the transcript.
 *
 * Conversations are seeded through the API rather than by chatting, so the test is
 * deterministic and never invokes the agent.
 *
 * Titles are unique per test: the suite runs fullyParallel against one shared database,
 * so a shared title makes every test see every other test's row.
 */

const ANSWER = "Playwright fixture: the Whitfield household, at 3.75% of assets.";

function questionFor(id: string) {
  return `Playwright fixture ${id}: which households hold the most cash?`;
}

/** Loads the app so relative fetch() calls in page.evaluate have an origin. No sign-in exists. */
async function openApp(page: Page) {
  await page.goto("/chat");
}

async function seedConversation(page: Page, question: string): Promise<string> {
  return page.evaluate(
    async ([q, a]) => {
      const created = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: q, kind: "chat" }),
      }).then((r) => r.json());

      const id: string = created.data.id;
      await fetch(`/api/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { id: `u-${id}`, role: "user", content: q },
            { id: `a-${id}`, role: "assistant", content: a },
          ],
        }),
      });
      return id;
    },
    [question, ANSWER],
  );
}

async function removeConversation(page: Page, id: string) {
  await page.evaluate((cid) => fetch(`/api/conversations/${cid}`, { method: "DELETE" }), id);
}

test.describe("conversation history", () => {
  test("a saved conversation lists in the sidebar and reopens with its transcript", async ({ page }) => {
    await openApp(page);
    const question = questionFor("reopen");
    const id = await seedConversation(page, question);

    try {
      await page.goto("/chat");

      const row = page.getByTestId("recent-row").filter({ hasText: question });
      await expect(row).toBeVisible();

      // The point of the feature: the row opens the conversation. Rows used to be inert.
      await row.click();
      await expect(page.getByText(ANSWER)).toBeVisible();

      // Restored, not re-sent — reopening must not write the transcript back as new.
      const count = await page.evaluate(
        async (q) =>
          fetch("/api/conversations")
            .then((r) => r.json())
            .then((b) => b.data.filter((c: { title: string }) => c.title === q).length),
        question,
      );
      expect(count).toBe(1);
    } finally {
      await removeConversation(page, id);
    }
  });

  test("pinning survives a reload", async ({ page }) => {
    await openApp(page);
    const question = questionFor("pin");
    const id = await seedConversation(page, question);

    try {
      await page.goto("/chat");
      const item = page.locator("li").filter({ hasText: question });
      await expect(item).toBeVisible();

      await item.getByTestId("recent-kebab").click();
      await page.getByRole("menuitem", { name: "Pin" }).click();

      await page.reload();
      await expect(page.getByText("Pinned", { exact: true })).toBeVisible();
      await expect(page.getByTestId("recent-row").filter({ hasText: question })).toBeVisible();
    } finally {
      await removeConversation(page, id);
    }
  });

  test("another user's conversation is not readable", async ({ page }) => {
    await openApp(page);

    // Conversations are scoped to their owner. A guessed id must 404 — a 403 would
    // confirm the conversation exists.
    const status = await page.evaluate(
      async () => (await fetch("/api/conversations/00000000-0000-0000-0000-000000000000")).status,
    );
    expect(status).toBe(404);
  });
});
