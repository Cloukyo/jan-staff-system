"use client";

import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  filterManagerHelpTasks,
  type ManagerHelpTask,
} from "@/lib/help/manager-help";

const groupOrder: ManagerHelpTask["group"][] = [
  "Daily work",
  "Staff records",
  "Clocking in",
  "Leave",
  "Pay hours",
  "Settings",
];

const commonTaskIds = [
  "add-missing-clock-event",
  "add-staff-member",
  "review-leave",
  "edit-rota",
];

export function ManagerHelpScreen({ tasks }: { tasks: ManagerHelpTask[] }) {
  const [query, setQuery] = useState("");
  const filteredTasks = useMemo(
    () =>
      query.trim()
        ? filterManagerHelpTasks(query).filter((task) =>
            tasks.some((availableTask) => availableTask.id === task.id),
          )
        : tasks,
    [query, tasks],
  );
  const commonTasks = tasks.filter((task) => commonTaskIds.includes(task.id));

  return (
    <div className="grid gap-8">
      <header>
        <h1 className="text-3xl font-black text-purple-950">How to</h1>
        <p className="mt-2 max-w-2xl text-slate-600">
          Find a task and go straight to the right place.
        </p>
      </header>

      <label className="grid max-w-2xl gap-2 text-sm font-bold text-purple-950">
        <span>Search help</span>
        <span className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-11 pr-3 text-base font-normal text-purple-950 outline-none transition placeholder:text-slate-400 focus:border-purple-600 focus:ring-4 focus:ring-purple-100"
            placeholder="For example, forgot to clock out"
          />
        </span>
      </label>

      {!query.trim() ? (
        <section aria-labelledby="common-help-tasks">
          <h2
            id="common-help-tasks"
            className="text-xl font-black text-purple-950"
          >
            Common tasks
          </h2>
          <div className="mt-3 grid border-y border-slate-200 sm:grid-cols-2">
            {commonTasks.map((task) => (
              <a
                key={task.id}
                href={`#${task.id}`}
                className="flex min-h-11 items-center justify-between gap-3 border-b border-slate-200 px-3 py-3 text-sm font-bold text-purple-800 last:border-b-0 hover:bg-purple-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700 sm:[&:nth-last-child(-n+2)]:border-b-0"
              >
                <span>{task.title}</span>
                <ArrowRight aria-hidden className="h-4 w-4 shrink-0" />
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {filteredTasks.length ? (
        <div className="grid gap-8">
          {groupOrder.map((group) => {
            const groupTasks = filteredTasks.filter(
              (task) => task.group === group,
            );
            if (groupTasks.length === 0) return null;
            const headingId = `help-group-${group.toLowerCase().replaceAll(" ", "-")}`;

            return (
              <section key={group} aria-labelledby={headingId}>
                <h2 id={headingId} className="text-xl font-black text-purple-950">
                  {group}
                </h2>
                <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
                  {groupTasks.map((task) => (
                    <article
                      key={task.id}
                      id={task.id}
                      className="scroll-mt-24 py-5"
                    >
                      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                        <div>
                          <h3 className="font-black text-purple-950">
                            {task.title}
                          </h3>
                          <p className="mt-1 text-sm text-slate-600">
                            {task.summary}
                          </p>
                          <ol className="mt-3 grid list-decimal gap-1 pl-5 text-sm text-slate-700">
                            {task.steps.map((step) => (
                              <li key={step} className="pl-1">
                                {step}
                              </li>
                            ))}
                          </ol>
                        </div>
                        <Link
                          href={task.href}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-purple-900 shadow-sm ring-1 ring-purple-200 transition hover:bg-purple-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700"
                        >
                          {task.shortcutLabel}
                          <ArrowRight
                            aria-hidden
                            className="h-4 w-4 shrink-0"
                          />
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <p
          className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center font-bold text-slate-700"
          role="status"
        >
          No help tasks match that search.
        </p>
      )}
    </div>
  );
}
