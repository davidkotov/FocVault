import DocsView from '@/components/site/DocsView'

export default function DocArticlePage({ params }: { params: { slug: string } }) {
  return <DocsView slug={params.slug} />
}
