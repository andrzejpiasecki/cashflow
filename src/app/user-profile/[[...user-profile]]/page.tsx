import { UserProfile } from "@clerk/nextjs";

export default function UserProfilePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <UserProfile path="/user-profile" routing="path" />
    </main>
  );
}
