import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck, Sparkles, Zap } from "lucide-react";
import AuthForm from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user && !user.isAnonymous) redirect("/playground");

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden border-r border-white/8 px-12 py-12 lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(700px_500px_at_20%_10%,rgba(59,130,246,0.24),transparent_60%),radial-gradient(600px_400px_at_90%_90%,rgba(34,211,238,0.12),transparent_55%)]" />
        <div className="relative">
          <Link href="/login" className="inline-flex items-center gap-3">
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
        </div>
        <div className="relative mt-auto max-w-xl pb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-violet-300/80">
            Honest AI model testing
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.15] tracking-tight text-white">
            Test free AI models
            <br />
            without the guesswork.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
            One workspace for free-tier and bring-your-own-key models. Every selectable model is
            verified. Every pause, error, and token count is real.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              {
                icon: ShieldCheck,
                title: "Verified access",
                body: "No unverified or fake models",
              },
              { icon: Zap, title: "Real requests", body: "Live latency and usage" },
              { icon: Sparkles, title: "Key-safe", body: "Encrypted BYOK storage" },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-xl border border-white/10 bg-white/[0.035] p-3.5"
              >
                <item.icon className="h-4 w-4 text-violet-300" />
                <p className="mt-2 text-xs font-semibold text-slate-200">{item.title}</p>
                <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-[11px] text-slate-600">
          Free-tier availability is controlled by each provider and can change.
        </p>
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
              Welcome back
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
              Sign in to your workspace
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Your keys, custom endpoints, and test history are isolated to your account.
            </p>
          </div>
          <div className="surface p-5 sm:p-6">
            <AuthForm mode="login" />
          </div>
          <div className="mt-6 rounded-xl border border-amber-400/15 bg-amber-400/[0.04] px-4 py-3 text-[11px] leading-5 text-amber-100/80">
            This app is self-hosted. Registration creates a local account; it does not use a
            third-party identity provider. Use a strong, unique password.
          </div>
        </div>
      </section>
    </div>
  );
}
