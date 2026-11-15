// /profile — alias al paginii de cont: redirecționare permanentă pe server către /account.
import { permanentRedirect } from 'next/navigation';

export default function ProfileAlias() {
  permanentRedirect('/account');
}
