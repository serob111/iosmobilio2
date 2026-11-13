import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

// useSearchParams() (inside LoginForm, for the "callbackUrl" a flow like /try's "save as
// project" button appends) needs a Suspense boundary around it.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
