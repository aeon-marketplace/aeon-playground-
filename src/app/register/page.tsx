import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, Sparkles, Zap } from "lucide-react";
import AuthForm from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { Alert } from "@/components/ui";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (user && !user.isAnonymous) redirect("/playground");
  const env = getEnv();

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden border-r border-white/8 px-12 py-12 lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(700px_500px_at_20%_10%,rgba(59,130,246,0.24),transparent_60%),radial-gradient(600px_400px_at_90%_90%,rgba(34,211,238,0.12),transparent_55%)]" />
        <Link href="/login" className="relative inline-flex items-center gap-3">
          <span className="flex h-11 items-center justify-center rounded-xl border border-blue-400/20 bg-black/40 px-3 shadow-lg shadow-blue-500/10">
            <Image
              src="/aeon-wordmark.png"
              alt="AEON"
              width={232}
              height={76}
              priority
              className="h-4 w-auto"
            />
          </span>
          <span>
            <span className="block text-sm font-semibold text-white">AI Playground</span>
            <span className="block text-[10px] uppercase tracking-[0.2em] text-slate-500">
              text + image · verified access
            </span>
          </span>
        </Link>
        <div className="relative mt-auto max-w-xl pb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-violet-300/80">
            Start with what works
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.15] tracking-tight text-white">
            A clean, honest
            <br />
            AI test bench.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
            Pollinations is live-verified and needs no key. Add your own keys for Gemini, Groq,
            OpenRouter, Hugging Face, or OpenAI when you have access.
          </p>
          <div className="mt-8 space-y-3">
            {[
              {
                icon: ShieldCheck,
                title: "No silent paid fallback",
                body: "The exact model you choose is the only one called.",
              },
              {
                icon: Zap,
                title: "Transparent results",
                body: "Latency, usage, and provider errors are recorded as-is.",
              },
              {
                icon: Sparkles,
                title: "Your data stays yours",
                body: "Per-user history and AES-256-GCM encrypted keys.",
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5">
                  <item.icon className="h-4 w-4 text-violet-300" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-200">{item.title}</p>
                  <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-12 sm:px-8 lg:min-h-0">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Link href="/login" className="inline-flex items-center gap-3">
              <span className="flex h-10 items-center justify-center rounded-xl border border-blue-400/20 bg-black/40 px-2.5">
                <Image
                  src="/aeon-wordmark.png"
                  alt="AEON"
                  width={232}
                  height={76}
                  className="h-3.5 w-auto"
                />
              </span>
              <span className="text-sm font-semibold text-white">AI Playground</span>
            </Link>
          </div>
          <div className="mb-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-300/80">
              Get started
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Create your local account
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              No email verification or third-party sign-in. This account lives in the app&apos;s
              database.
            </p>
          </div>
          {!env.allowRegistration ? (
            <div className="surface p-5">
              <Alert tone="amber" title="Registration is disabled">
                This deployment is not accepting new accounts. Ask the operator for access, or sign
                in with an existing account.
              </Alert>
              <Link href="/login" className="btn btn-secondary mt-4 w-full">
                Back to sign in
              </Link>
            </div>
          ) : (
            <div className="surface p-5 sm:p-6">
              <AuthForm mode="register" />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
