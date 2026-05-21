import { serverFetch } from '@/lib/api';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ guildId: string }> },
): Promise<Response> {
  const { guildId } = await params;
  const data = await serverFetch<unknown>(`/admin/guilds/${guildId}/export`);
  const json = JSON.stringify(data, null, 2);
  return new Response(json, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="guild-${guildId}-config.json"`,
    },
  });
}
