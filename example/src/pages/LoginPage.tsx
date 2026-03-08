import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { Vault } from "@phosphor-icons/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Username is required");
      return;
    }
    login(trimmed);
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <div
        className="w-full max-w-sm"
        style={{ animation: "fadeUp 0.5s ease-out" }}
      >
        <div className="flex flex-col items-center gap-4 mb-6">
          <div className="flex size-12 items-center justify-center bg-primary text-primary-foreground font-bold select-none shadow-lg shadow-primary/25">
            <Vault size={24} weight="fill" />
          </div>
          <div className="text-center">
            <h1 className="text-sm font-bold tracking-widest uppercase">
              Secret Vault
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Encrypted credential management
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              Enter a username to access the vault demo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError("");
                  }}
                  placeholder="operator"
                  autoFocus
                />
                {error && (
                  <p className="text-xs text-destructive">{error}</p>
                )}
              </div>
              <Button type="submit" className="w-full">
                Continue
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
