use std::io::{IsTerminal, Read};
use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use gitbrain_mem::{default_dir, NewDrawer, Palace, SearchOpts};

/// Local shared memory for AI agents: wings, rooms and verbatim drawers.
#[derive(Parser)]
#[command(name = "gitbrain-mem", version)]
struct Cli {
    /// Palace directory (default: $GITBRAIN_MEM_DIR or ~/.gitbrain/palace)
    #[arg(long, global = true)]
    palace: Option<PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Store text verbatim. Reads stdin when TEXT is omitted.
    Add {
        #[arg(long)]
        wing: String,
        #[arg(long)]
        room: String,
        #[arg(long)]
        source: Option<String>,
        text: Option<String>,
    },
    /// Search memory (BM25).
    Search {
        query: String,
        #[arg(long)]
        wing: Option<String>,
        #[arg(long)]
        room: Option<String>,
        #[arg(short = 'n', long, default_value_t = 10)]
        limit: usize,
        /// Print JSON instead of text
        #[arg(long)]
        json: bool,
    },
    /// List wings, rooms and drawer counts.
    Wings {
        #[arg(long)]
        json: bool,
    },
    /// Run the MCP server on stdio.
    Serve,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let palace = Palace::open(cli.palace.unwrap_or_else(default_dir))?;
    match cli.cmd {
        Cmd::Add {
            wing,
            room,
            source,
            text,
        } => {
            let text = match text {
                Some(t) => t,
                None if !std::io::stdin().is_terminal() => {
                    let mut s = String::new();
                    std::io::stdin().read_to_string(&mut s)?;
                    s
                }
                None => anyhow::bail!("give TEXT or pipe it on stdin"),
            };
            let d = palace.add(NewDrawer {
                wing,
                room,
                text,
                source,
            })?;
            println!("{}", d.id);
        }
        Cmd::Search {
            query,
            wing,
            room,
            limit,
            json,
        } => {
            let hits = palace.search(&query, &SearchOpts { wing, room, limit })?;
            if json {
                println!("{}", serde_json::to_string_pretty(&hits)?);
            } else if hits.is_empty() {
                eprintln!("no matches");
            } else {
                for h in hits {
                    println!(
                        "── {}/{}  score {:.2}  {}",
                        h.drawer.wing, h.drawer.room, h.score, h.drawer.id
                    );
                    println!("{}\n", h.drawer.text.trim_end());
                }
            }
        }
        Cmd::Wings { json } => {
            let wings = palace.list_wings()?;
            if json {
                println!("{}", serde_json::to_string_pretty(&wings)?);
            } else {
                for w in wings {
                    println!("{} ({})", w.wing, w.drawers);
                    for r in w.rooms {
                        println!("  {} ({})", r.room, r.drawers);
                    }
                }
            }
        }
        Cmd::Serve => {
            eprintln!(
                "gitbrain-mem: MCP server on stdio, palace {}",
                palace.dir().display()
            );
            let stdin = std::io::stdin();
            gitbrain_mem::mcp::serve(&palace, stdin.lock(), std::io::stdout().lock())?;
        }
    }
    Ok(())
}
