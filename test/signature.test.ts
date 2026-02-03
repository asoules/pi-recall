import { describe, it, expect } from "vitest";
import { extractSignature, extractSignatureLines, detectLanguage, supportedLanguages } from "../src/signature.js";

describe("detectLanguage", () => {
	it("maps common extensions", () => {
		expect(detectLanguage("foo.ts")).toBe("typescript");
		expect(detectLanguage("foo.tsx")).toBe("tsx");
		expect(detectLanguage("foo.js")).toBe("javascript");
		expect(detectLanguage("foo.py")).toBe("python");
		expect(detectLanguage("foo.rb")).toBe("ruby");
		expect(detectLanguage("foo.go")).toBe("go");
		expect(detectLanguage("foo.rs")).toBe("rust");
		expect(detectLanguage("foo.java")).toBe("java");
		expect(detectLanguage("foo.swift")).toBe("swift");
		expect(detectLanguage("foo.c")).toBe("c");
		expect(detectLanguage("foo.cpp")).toBe("cpp");
		expect(detectLanguage("foo.cs")).toBe("csharp");
		expect(detectLanguage("foo.dart")).toBe("dart");
		expect(detectLanguage("foo.php")).toBe("php");
	});

	it("returns null for unsupported", () => {
		expect(detectLanguage("foo.txt")).toBeNull();
		expect(detectLanguage("foo")).toBeNull();
		expect(detectLanguage("Makefile")).toBeNull();
	});
});

describe("supportedLanguages", () => {
	it("returns all configured languages", () => {
		const langs = supportedLanguages();
		expect(langs).toContain("typescript");
		expect(langs).toContain("python");
		expect(langs).toContain("ruby");
		expect(langs).toContain("go");
		expect(langs).toContain("rust");
		expect(langs.length).toBeGreaterThanOrEqual(13);
	});
});

describe("extractSignature", () => {
	it("extracts TypeScript class and interface names", async () => {
		const code = `
export interface UserService {
	getUser(id: string): Promise<User>;
}

export class UserServiceImpl implements UserService {
	constructor(private db: Database) {}

	async getUser(id: string): Promise<User> {
		return this.db.find(id);
	}
}

export type UserId = string;

export function createUserService(db: Database): UserService {
	return new UserServiceImpl(db);
}
`;
		const sig = await extractSignature("src/user-service.ts", code);
		expect(sig).not.toBeNull();
		expect(sig).toContain("src/user-service.ts");
		expect(sig).toContain("UserService");
		expect(sig).toContain("UserServiceImpl");
		expect(sig).toContain("UserId");
		expect(sig).toContain("createUserService");
	});

	it("extracts Python class and function names", async () => {
		const code = `
class EventRepository:
    def __init__(self, db):
        self.db = db

    def soft_delete(self, event_id):
        self.db.update(event_id, deleted=True)

def create_repository(db):
    return EventRepository(db)
`;
		const sig = await extractSignature("models/events.py", code);
		expect(sig).not.toBeNull();
		expect(sig).toContain("EventRepository");
		expect(sig).toContain("create_repository");
	});

	it("extracts Ruby module and class names", async () => {
		const code = `
module Payments
  class RefundProcessor
    def initialize(gateway)
      @gateway = gateway
    end

    def process(refund)
      @gateway.refund(refund.amount)
    end
  end
end
`;
		const sig = await extractSignature("lib/payments/refund.rb", code);
		expect(sig).not.toBeNull();
		expect(sig).toContain("Payments");
		expect(sig).toContain("RefundProcessor");
	});

	it("extracts Go package, types, and functions", async () => {
		const code = `
package events

type EventStore struct {
	db *sql.DB
}

type EventReader interface {
	Read(id string) (*Event, error)
}

func NewEventStore(db *sql.DB) *EventStore {
	return &EventStore{db: db}
}

func (s *EventStore) SoftDelete(id string) error {
	_, err := s.db.Exec("UPDATE events SET deleted_at = NOW() WHERE id = ?", id)
	return err
}
`;
		const sig = await extractSignature("store/events.go", code);
		expect(sig).not.toBeNull();
		expect(sig).toContain("events");
		expect(sig).toContain("EventStore");
		expect(sig).toContain("EventReader");
		expect(sig).toContain("NewEventStore");
		expect(sig).toContain("SoftDelete");
	});

	it("extracts Rust structs, traits, and functions", async () => {
		const code = `
mod events {
    pub struct Event {
        pub id: String,
        pub deleted_at: Option<DateTime>,
    }

    pub trait EventRepository {
        fn find(&self, id: &str) -> Option<Event>;
        fn soft_delete(&self, id: &str) -> Result<(), Error>;
    }

    pub fn create_event(id: String) -> Event {
        Event { id, deleted_at: None }
    }
}
`;
		const sig = await extractSignature("src/events.rs", code);
		expect(sig).not.toBeNull();
		expect(sig).toContain("events");
		expect(sig).toContain("Event");
		expect(sig).toContain("EventRepository");
		expect(sig).toContain("create_event");
	});

	it("extracts Java class and method names", async () => {
		const code = `
package com.example.events;

public class EventService {
    private final EventRepository repository;

    public EventService(EventRepository repository) {
        this.repository = repository;
    }

    public void softDelete(String eventId) {
        repository.markDeleted(eventId);
    }
}
`;
		const sig = await extractSignature("src/EventService.java", code);
		expect(sig).not.toBeNull();
		expect(sig).toContain("EventService");
	});

	it("extracts C struct and function names", async () => {
		const code = `
typedef struct {
    int id;
    int deleted;
} Event;

struct EventStore {
    sqlite3 *db;
};

Event* event_create(int id) {
    Event* e = malloc(sizeof(Event));
    e->id = id;
    e->deleted = 0;
    return e;
}

void event_soft_delete(Event* e) {
    e->deleted = 1;
}
`;
		const sig = await extractSignature("src/events.c", code);
		expect(sig).not.toBeNull();
		expect(sig).toContain("Event");
		expect(sig).toContain("EventStore");
		expect(sig).toContain("event_create");
		expect(sig).toContain("event_soft_delete");
	});

	it("returns null for unsupported file types", async () => {
		const sig = await extractSignature("README.md", "# Hello World");
		expect(sig).toBeNull();
	});

	it("returns null for empty files", async () => {
		const sig = await extractSignature("empty.ts", "");
		expect(sig).toBeNull();
	});
});

describe("extractSignatureLines", () => {
	it("extracts full declaration lines for TypeScript", async () => {
		const code = `
export class EventService extends BaseService {
	softDelete(id: string): void {}
}

export interface EventRepository {
	find(id: string): Event;
}
`;
		const sig = await extractSignatureLines("src/events.ts", code);
		expect(sig).not.toBeNull();
		expect(sig).toContain("class EventService extends BaseService");
		expect(sig).toContain("interface EventRepository");
	});
});
