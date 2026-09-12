from alembic import context
from app.config import Settings
from app.db import Base, Database

database = Database(Settings().database_url)
with database.engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
