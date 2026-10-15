"use client";
import {useCallback,useEffect,useState} from "react";
import {supabase} from "../../lib/supabase";

export default function AdminDiagnostics(){
  const [data,setData]=useState(null);
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const {data:sessionData,error:sessionError}=await supabase?.auth.getSession()||{};
      const token=sessionData?.session?.access_token;
      if(sessionError||!token)throw new Error("Sign in with an authorized admin account to view diagnostics.");
      const response=await fetch("/api/adminishere/admin/diagnostics",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error((body.error||"Diagnostics are unavailable.")+(body.errorId?" Error ID: "+body.errorId:""));
      setData(body);
    }catch(e){setError(e?.message||"Diagnostics could not be loaded.")}
    finally{setLoading(false)}
  },[]);
  useEffect(()=>{load()},[load]);
  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Alpha.ai admin diagnostics</h1><p className="mt-1 text-sm text-muted-foreground">Private operational status. Secrets and provider credentials are never displayed.</p></div>
      <button type="button" onClick={load} disabled={loading} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{loading?"Refreshing…":"Refresh"}</button>
    </header>
    {error&&<p role="alert" className="rounded-lg border p-4 text-sm">{error}</p>}
    {loading&&!data&&<p role="status" className="text-sm">Loading diagnostics…</p>}
    {data&&<>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(data.queue||{}).map(([key,value])=><article key={key} className="rounded-xl border p-4"><p className="text-sm capitalize text-muted-foreground">{key.replace(/([A-Z])/g," $1")}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></article>)}
      </section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Processing jobs</h2><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Status</th><th className="p-3">Failure</th><th className="p-3">Progress</th><th className="p-3">Attempts</th><th className="p-3">Error ID</th><th className="p-3">Updated</th></tr></thead><tbody>{(data.jobs||[]).map(job=><tr key={job.id} className="border-b last:border-0"><td className="p-3">{job.status}</td><td className="p-3">{job.failureType||"—"}{job.reason&&<p className="mt-1 max-w-sm text-xs text-muted-foreground">{job.reason}</p>}</td><td className="p-3">{job.progress??0}%</td><td className="p-3">{job.attempts}</td><td className="p-3 font-mono text-xs">{job.errorId||"—"}</td><td className="p-3 whitespace-nowrap">{job.updatedAt?new Date(job.updatedAt).toLocaleString():"—"}</td></tr>)}</tbody></table></div></section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Gemini key health</h2><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Environment label</th><th className="p-3">State</th><th className="p-3">Successes</th><th className="p-3">Failures</th><th className="p-3">429s</th><th className="p-3">Last used</th></tr></thead><tbody>{(data.geminiKeyHealth||[]).map(key=><tr key={key.key_label} className="border-b last:border-0"><td className="p-3 font-mono">{key.key_label}</td><td className="p-3">{key.currentlyCoolingDown?"Cooldown":key.is_available?"Available":"Unavailable"}</td><td className="p-3">{key.success_count}</td><td className="p-3">{key.failure_count}</td><td className="p-3">{key.rate_limit_count}</td><td className="p-3">{key.last_used_at?new Date(key.last_used_at).toLocaleString():"—"}</td></tr>)}</tbody></table></div></section>
      <section className="space-y-3"><h2 className="text-lg font-semibold">Recent credit transactions</h2><div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-3">Type</th><th className="p-3">Amount</th><th className="p-3">Reason</th><th className="p-3">Transaction ID</th><th className="p-3">Created</th></tr></thead><tbody>{(data.creditTransactions||[]).map(item=><tr key={item.transactionId} className="border-b last:border-0"><td className="p-3">{item.type}</td><td className="p-3 tabular-nums">{item.amount>0?"+":""}{item.amount}</td><td className="p-3">{item.reason}</td><td className="p-3 font-mono text-xs">{item.transactionId}</td><td className="p-3 whitespace-nowrap">{new Date(item.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div></section>
      <p className="text-xs text-muted-foreground">Updated {new Date(data.generatedAt).toLocaleString()}. Job and workspace identifiers are only visible to authorized administrators.</p>
    </>}
  </main>;
}
