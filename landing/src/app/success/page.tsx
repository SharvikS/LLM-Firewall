import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';

export default function SuccessPage() {
  return (
    <main className="min-h-screen bg-base-main px-5 py-20 text-base-text">
      <section className="mx-auto max-w-xl rounded-xl border border-base-border bg-base-card p-8">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg border border-base-border bg-white/[0.03]">
          <CheckCircle2 size={22} />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Payment received</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-base-muted">
          Your TITAN plan is active in Stripe. Activate your hosted workspace to get
          the dashboard login, gateway base URL, and app API key.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link href="/start" className="inline-flex items-center justify-center gap-2 rounded-xl btn-primary px-5 py-3 text-[14px] font-medium">
            Activate workspace <ArrowRight size={15} />
          </Link>
          <Link href="/#pricing" className="inline-flex items-center justify-center rounded-xl btn-ghost px-5 py-3 text-[14px] font-medium">
            Back to pricing
          </Link>
        </div>
      </section>
    </main>
  );
}
