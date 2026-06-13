"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectMutation } from "@/components/project/use-project-convex";
import { useProjectPath } from "@/components/project/ProjectProvider";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

type FormatType = "carousel" | "short" | "screenrecorder" | "custom";
const TYPE_OPTIONS: { value: FormatType; label: string }[] = [
  { value: "carousel", label: "Carrousel" },
  { value: "short", label: "Short" },
  { value: "screenrecorder", label: "ScreenRecorder" },
  { value: "custom", label: "Custom" },
];

/**
 * P6 — création minimale d'un format (nom + type) → redirige vers la fiche
 * détail où l'admin complète brief / hooks / exemples / rému.
 */
export function NewFormatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useProjectMutation(api.formats.createFormat);
  const router = useRouter();
  const projectPath = useProjectPath();
  const [name, setName] = useState("");
  const [type, setType] = useState<FormatType>("short");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const id = await create({ name: name.trim(), type });
      toast.success("Format créé");
      onOpenChange(false);
      setName("");
      router.push(projectPath(`/formats/${id}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau format</DialogTitle>
          <DialogDescription>
            Donne un nom et un type ; tu compléteras le brief ensuite.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-format-name">Nom *</Label>
            <Input
              id="new-format-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => v && setType(v as FormatType)}>
              <SelectTrigger aria-label="Type de format">
                <SelectValue>
                  {TYPE_OPTIONS.find((o) => o.value === type)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Annuler
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
