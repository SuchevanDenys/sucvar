import StatusPage from '@/app/components/layout/StatusPage';

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      titleRo="Pagina nu există"
      titleEn="Page not found"
      textRo="Adresa accesată nu corespunde niciunei pagini SUCVAR."
      textEn="The address does not match any SUCVAR page."
    />
  );
}
