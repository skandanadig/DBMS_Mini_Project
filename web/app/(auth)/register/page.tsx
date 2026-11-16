import { Suspense } from "react";
import { AuthForm } from "../AuthForm";

export const metadata = { title: "Create account · SkillMatch" };

export default function RegisterPage() {
  return (
    <Suspense>
      <AuthForm mode="register" />
    </Suspense>
  );
}
