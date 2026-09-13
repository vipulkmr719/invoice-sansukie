import { RegisterForm } from '@/components/auth/AuthForm';
import { registerAction } from '@/server/actions/auth';

export const metadata = { title: '新規登録' };

export default function RegisterPage() {
  return <RegisterForm action={registerAction} />;
}
