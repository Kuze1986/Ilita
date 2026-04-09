import { Suspense } from "react";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { AdminLoginForm } from "./AdminLoginForm";

export default function AdminLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center py-16">
          <LoadingSpinner className="h-10 w-10" />
        </div>
      }
    >
      <AdminLoginForm />
    </Suspense>
  );
}
