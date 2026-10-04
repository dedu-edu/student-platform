# Paste into backend/main.py (near the other /admin routes).
# The frontend's "remove admin" and "delete email" buttons need these two routes.
# Also REPLACE the existing @app.get("/users") with the protected version below:
# the current one is public and returns password hashes.

@app.get("/users", response_model=list[UserResponse])
def get_users(
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    return db.query(User).all()


@app.put("/admin/users/{user_id}/remove-admin")
def remove_user_admin(
    user_id: int,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current_admin.id:
        raise HTTPException(
            status_code=400,
            detail="You cannot remove your own admin access"
        )

    user.is_admin = False
    db.commit()

    return {"message": "Admin access removed", "username": user.username}


@app.delete("/admin/allowed-emails/{email_id}")
def delete_allowed_email(
    email_id: int,
    current_admin: User = Depends(get_current_admin),
    db: Session = Depends(get_db)
):
    item = db.query(models.AllowedEmail).filter(
        models.AllowedEmail.id == email_id
    ).first()

    if not item:
        raise HTTPException(status_code=404, detail="Email not found")

    db.delete(item)
    db.commit()

    return {"message": "Email removed from allowlist"}
