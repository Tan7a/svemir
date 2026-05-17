import TopBar from "@/components/TopBar";
import AdminTabs from "@/components/AdminTabs";
import { supabaseAdmin } from "@/lib/supabase-server";
import TokensClient, { type TokenRow } from "./TokensClient";

export const dynamic = "force-dynamic";

export default async function TokensPage() {
  let tokens: TokenRow[] = [];
  let error: string | null = null;

  if (!supabaseAdmin) {
    error = "Supabase admin is not configured on the server.";
  } else {
    const { data, error: queryError } = await supabaseAdmin
      .from("api_tokens")
      .select("id, name, created_at, last_used_at")
      .order("created_at", { ascending: false });
    if (queryError) {
      error = queryError.message;
    } else {
      tokens = (data ?? []) as TokenRow[];
    }
  }

  return (
    <>
      <TopBar />
      <AdminTabs active="tokens" />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="mb-2 text-2xl font-light text-neutral-100">
          Personal access tokens
        </h1>
        <p className="mb-6 text-sm text-neutral-400">
          Mint bearer tokens for the Chrome extension or scripts that POST to
          <code className="ml-1 rounded bg-neutral-900 px-1 text-neutral-200">
            /api/v1/blocks
          </code>
          .
        </p>
        {error ? (
          <p className="rounded-md border border-red-900 bg-red-950 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : (
          <TokensClient initialTokens={tokens} />
        )}
      </main>
    </>
  );
}
