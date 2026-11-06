import { useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";
import { Card, Loading, PageHeader, Select, Stat, Table, Td, pct, useAsync } from "../ui";

type Overview = {
  days: number;
  totals: Record<string, number>;
  daily: { day: string; page_views: number; searches: number; article_views: number }[];
  topArticles: { id: number; slug: string; title: string; views: number }[];
  topSearches: { query: string; n: number; avg_results: number; clicks: number }[];
  zeroResults: { query: string; n: number }[];
};

function Bars({ data, k }: { data: Overview["daily"]; k: "searches" | "article_views" | "page_views" }) {
  const max = Math.max(1, ...data.map((d) => d[k]));
  return (
    <div className="flex h-16 items-end gap-[3px]" role="img" aria-label={`Daily ${k.replace("_", " ")}`}>
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1">
          <div className="rounded-sm bg-brand-500/80 transition-colors group-hover:bg-brand-600" style={{ height: `${Math.max(2, (d[k] / max) * 64)}px` }} />
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-white group-hover:block">
            {d.day.slice(5)}: {d[k]}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [days, setDays] = useState(30);
  const { data, loading } = useAsync(() => get<Overview>(`/admin/analytics/overview?days=${days}`), [days]);
  return (
    <>
      <PageHeader
        title="Overview"
        description="How people use the help center and in-app guidance."
        actions={
          <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36" aria-label="Date range">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </Select>
        }
      />
      {loading || !data ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Searches" value={data.totals.searches} sub={`${pct(data.totals.zero_result_searches, data.totals.searches)} found nothing`} />
            <Stat label="AI overviews shown" value={data.totals.ai_answers} sub={`${pct(data.totals.helpful_yes, data.totals.helpful_yes + data.totals.helpful_no)} rated helpful`} />
            <Stat label="Article views" value={data.totals.article_views} />
            <Stat label="Prompt conversion" value={pct(data.totals.prompts_converted, data.totals.prompts_shown)} sub={`${data.totals.prompts_shown} impressions`} />
            <Stat label="Page views (snippet)" value={data.totals.page_views} />
            <Stat label="Consented sessions" value={data.totals.consented_sessions} sub="Sessions with analytics consent" />
            <Stat label="Identified visitors" value={data.totals.identified_visitors} sub="Pseudonymous ids only" />
            <Stat label="AI nudges clicked" value={pct(data.totals.nudges_clicked, data.totals.nudges_shown)} sub={`${data.totals.nudges_shown} shown`} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Searches per day">
              <Bars data={data.daily} k="searches" />
            </Card>
            <Card title="Article views per day">
              <Bars data={data.daily} k="article_views" />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Top searches">
              <Table head={["Query", "Searches", "Clicked"]} empty="No searches yet">
                {data.topSearches.map((s) => (
                  <tr key={s.query}>
                    <Td className="font-medium">{s.query}</Td>
                    <Td className="tabular-nums">{s.n}</Td>
                    <Td className="tabular-nums">{pct(s.clicks, s.n)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="Searches with no results" actions={<span className="text-xs text-zinc-500">Content gaps</span>}>
              <Table head={["Query", "Searches"]} empty="Nothing here. Every search found something.">
                {data.zeroResults.map((s) => (
                  <tr key={s.query}>
                    <Td className="font-medium">{s.query}</Td>
                    <Td className="tabular-nums">{s.n}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>

          <Card title="Most read articles">
            <Table head={["Article", "Views"]} empty="No article views yet">
              {data.topArticles.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link to={`/admin/articles/${a.id}`} className="font-medium hover:text-brand-600">
                      {a.title}
                    </Link>
                  </Td>
                  <Td className="tabular-nums">{a.views}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
