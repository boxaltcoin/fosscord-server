/*
	Fosscord: A FOSS re-implementation and extension of the Discord.com backend.
	Copyright (C) 2023 Fosscord and Fosscord Contributors
	
	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU Affero General Public License as published
	by the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.
	
	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU Affero General Public License for more details.
	
	You should have received a copy of the GNU Affero General Public License
	along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { Column, Entity, JoinColumn, ManyToOne, RelationId } from "typeorm";
import { BaseClass } from "./BaseClass";
import { User } from "./User";

export type PublicConnectedAccount = Pick<
	ConnectedAccount,
	"name" | "type" | "verified"
>;

@Entity("connected_accounts")
export class ConnectedAccount extends BaseClass {
	@Column({ nullable: true })
	@RelationId((account: ConnectedAccount) => account.user)
	user_id: string;

	@JoinColumn({ name: "user_id" })
	@ManyToOne(() => User, {
		onDelete: "CASCADE",
	})
	user: User;

	@Column({ select: false })
	access_token: string;

	@Column({ select: false })
	friend_sync: boolean;

	@Column()
	name: string;

	@Column({ select: false })
	revoked: boolean;

	@Column({ select: false })
	show_activity: boolean;

	@Column()
	type: string;

	@Column()
	verified: boolean;

	@Column({ select: false })
	visibility: number;
}
