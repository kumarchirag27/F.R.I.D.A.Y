"""
Cybersecurity news fetcher — pulls latest headlines from multiple RSS feeds.
"""

import feedparser
import logging
from datetime import datetime

logger = logging.getLogger("friday.tools.cyber_news")

FEEDS = [
    {"name": "The Hacker News", "url": "https://feeds.feedburner.com/TheHackersNews"},
    {"name": "BleepingComputer", "url": "https://www.bleepingcomputer.com/feed/"},
    {"name": "CISA Alerts", "url": "https://www.cisa.gov/cybersecurity-advisories/all.xml"},
    {"name": "Krebs on Security", "url": "https://krebsonsecurity.com/feed/"},
]


def get_cyber_news(count: int = 10) -> dict:
    """Fetch latest cybersecurity news from RSS feeds."""
    articles = []

    for feed_info in FEEDS:
        try:
            feed = feedparser.parse(feed_info["url"])
            for entry in feed.entries[:5]:
                published = ""
                if hasattr(entry, "published"):
                    published = entry.published
                elif hasattr(entry, "updated"):
                    published = entry.updated

                articles.append({
                    "title": entry.get("title", "").strip(),
                    "source": feed_info["name"],
                    "link": entry.get("link", ""),
                    "published": published,
                    "summary": (entry.get("summary", "") or "")[:200].strip(),
                })
        except Exception as e:
            logger.warning(f"Failed to fetch {feed_info['name']}: {e}")

    # Sort by published date (newest first), take top N
    articles.sort(key=lambda a: a.get("published", ""), reverse=True)
    articles = articles[:count]

    return {
        "count": len(articles),
        "articles": articles,
        "fetched_at": datetime.utcnow().isoformat(),
    }
