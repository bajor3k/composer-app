import { redirect } from "next/navigation";

// The workspace chat is the app's home screen.
export default function Home() {
  redirect("/chat");
}
