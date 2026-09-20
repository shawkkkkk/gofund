import { hasDatabase, query } from "@/lib/db";

type Token={mint:string;name:string;symbol:string;quote_asset:string;fee_status:string;title:string;canonical_url:string};

export default async function Explore(){
  let rows:Token[]=[];
  if(hasDatabase()) try{
    rows=(await query<Token>("select t.mint,t.name,t.symbol,t.quote_asset,t.fee_status,c.title,c.canonical_url from tokens t join campaigns c on c.id=t.campaign_id where t.fee_status='LOCKED' order by t.locked_at desc limit 60")).rows;
  } catch {}
  return <main className="shell">
    <div className="page-head"><div className="kicker">Explore</div><h1>Fundraisers with markets.</h1><p className="lead">Only tokens whose 100% GoFund fee share has been verified on-chain appear here.</p></div>
    <div className="grid" style={{paddingBottom:80}}>
      {rows.length ? rows.map(r=><article className="card" key={r.mint}>
        <div className="eyebrow">{r.title}</div>
        <h3 style={{fontSize:28,marginTop:8}}>{r.name} <span className="muted">${r.symbol}</span></h3>
        <p><a href={r.canonical_url} target="_blank" rel="noreferrer">View fundraiser ↗</a></p>
        <div className="token-line"><span>{r.quote_asset}</span><span className="badge locked">LOCKED</span></div>
      </article>) : <div className="card"><h3>No locked tokens yet.</h3><p className="muted">The first verified launch will appear here.</p></div>}
    </div>
  </main>;
}
