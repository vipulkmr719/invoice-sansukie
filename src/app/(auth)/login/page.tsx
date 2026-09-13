import { LoginForm } from '@/components/auth/AuthForm';
import { loginAction } from '@/server/actions/auth';

export const metadata = { title: 'ログイン' };

export default function LoginPage() {
  return <LoginForm action={loginAction} />;
}
