import { CurrentUser } from '@bandada/auth-ts/nest';
import { Idempotent } from '@bandada/idempotency-ts/nest';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';

import { CreateCommentUseCase } from '../../../use-cases/comments/create-comment.use-case';
import { ListCommentsUseCase } from '../../../use-cases/comments/list-comments.use-case';
import { GetFeedUseCase } from '../../../use-cases/feed/get-feed.use-case';
import { ListGroupPostsUseCase } from '../../../use-cases/feed/list-group-posts.use-case';
import { FollowUserUseCase, GetFollowSuggestionsUseCase, UnfollowUserUseCase } from '../../../use-cases/follows/follow.use-cases';
import {
  CreateGroupUseCase,
  GetGroupUseCase,
  JoinGroupUseCase,
  LeaveGroupUseCase,
  ListGroupMembersUseCase,
  ReviewGroupMemberUseCase,
  SearchGroupsUseCase,
} from '../../../use-cases/groups/group.use-cases';
import { CreatePostUseCase } from '../../../use-cases/posts/create-post.use-case';
import { DeletePostUseCase } from '../../../use-cases/posts/delete-post.use-case';
import { GetPostUseCase } from '../../../use-cases/posts/get-post.use-case';
import { GetProfileUseCase, UpdateMyProfileUseCase } from '../../../use-cases/profiles/profile.use-cases';
import { RemoveReactionUseCase, SetReactionUseCase } from '../../../use-cases/reactions/set-reaction.use-case';
import { ReportContentUseCase } from '../../../use-cases/reports/report-content.use-case';
import { decodeCursor } from '../../presenters/cursor';
import {
  page,
  presentComment,
  presentFeedItem,
  presentFollow,
  presentGroup,
  presentMembership,
  presentMembershipOutput,
  presentPost,
  presentProfile,
  presentReaction,
  presentReport,
} from '../../presenters/resource.presenter';
import {
  createCommentBody,
  createGroupBody,
  createPostBody,
  listGroupsQuery,
  listMembersQuery,
  pageQuery,
  reportBody,
  setReactionBody,
  suggestionsQuery,
  updateProfileBody,
  uuidParam,
} from './dto/schemas';
import { ZodValidationPipe } from './dto/zod-validation.pipe';

const id = (name: string) => new ZodValidationPipe(uuidParam, name);
type In<S extends z.ZodType> = z.output<S>;

@Controller('api/v1/profiles')
export class ProfilesController {
  constructor(
    @Inject(GetProfileUseCase) private readonly getProfile: GetProfileUseCase,
    @Inject(UpdateMyProfileUseCase) private readonly updateProfile: UpdateMyProfileUseCase,
  ) {}

  @Get('me')
  async me(@CurrentUser('sub') userId: string) {
    return presentProfile(await this.getProfile.execute({ userId, viewerId: userId }));
  }

  @Patch('me')
  async updateMe(@CurrentUser('sub') userId: string, @Body(new ZodValidationPipe(updateProfileBody)) body: In<typeof updateProfileBody>) {
    return presentProfile(await this.updateProfile.execute({ userId, ...body }));
  }

  @Get(':userId')
  async byId(@CurrentUser('sub') viewerId: string, @Param('userId', id('userId')) userId: string) {
    return presentProfile(await this.getProfile.execute({ userId, viewerId }));
  }
}

@Controller('api/v1/posts')
export class PostsController {
  constructor(
    @Inject(CreatePostUseCase) private readonly createPost: CreatePostUseCase,
    @Inject(GetPostUseCase) private readonly getPost: GetPostUseCase,
    @Inject(DeletePostUseCase) private readonly deletePost: DeletePostUseCase,
    @Inject(CreateCommentUseCase) private readonly createComment: CreateCommentUseCase,
    @Inject(ListCommentsUseCase) private readonly listComments: ListCommentsUseCase,
    @Inject(SetReactionUseCase) private readonly setReaction: SetReactionUseCase,
    @Inject(RemoveReactionUseCase) private readonly removeReaction: RemoveReactionUseCase,
  ) {}

  @Post()
  @Idempotent()
  async create(@CurrentUser('sub') authorId: string, @Body(new ZodValidationPipe(createPostBody)) body: In<typeof createPostBody>, @Res({ passthrough: true }) res: Response) {
    const { output, replayed } = await this.createPost.execute({ authorId, ...body });
    res.status(replayed ? 200 : 201);
    return presentPost(output);
  }

  @Get(':postId')
  async get(@CurrentUser('sub') viewerId: string, @Param('postId', id('postId')) postId: string) {
    return presentPost(await this.getPost.execute({ postId, viewerId }));
  }

  @Delete(':postId')
  @HttpCode(204)
  async remove(@CurrentUser('sub') userId: string, @Param('postId', id('postId')) postId: string): Promise<void> {
    await this.deletePost.execute({ postId, userId });
  }

  @Post(':postId/comments')
  @Idempotent()
  async comment(@CurrentUser('sub') authorId: string, @Param('postId', id('postId')) postId: string, @Body(new ZodValidationPipe(createCommentBody)) body: In<typeof createCommentBody>) {
    return presentComment(await this.createComment.execute({ postId, authorId, text: body.text, parentId: body.parentId ?? null }));
  }

  @Get(':postId/comments')
  async comments(@CurrentUser('sub') viewerId: string, @Param('postId', id('postId')) postId: string, @Query(new ZodValidationPipe(pageQuery)) q: In<typeof pageQuery>) {
    return page(await this.listComments.execute({ postId, viewerId, cursor: decodeCursor(q.cursor), limit: q.limit }), presentComment);
  }

  @Put(':postId/reactions/me')
  @HttpCode(200)
  async react(@CurrentUser('sub') userId: string, @Param('postId', id('postId')) postId: string, @Body(new ZodValidationPipe(setReactionBody)) body: In<typeof setReactionBody>) {
    return presentReaction(await this.setReaction.execute({ postId, userId, type: body.type }));
  }

  @Delete(':postId/reactions/me')
  @HttpCode(204)
  async unreact(@CurrentUser('sub') userId: string, @Param('postId', id('postId')) postId: string): Promise<void> {
    await this.removeReaction.execute({ postId, userId });
  }
}

@Controller('api/v1/feed')
export class FeedController {
  constructor(@Inject(GetFeedUseCase) private readonly getFeed: GetFeedUseCase) {}

  @Get()
  async feed(@CurrentUser('sub') userId: string, @Query(new ZodValidationPipe(pageQuery)) q: In<typeof pageQuery>) {
    return page(await this.getFeed.execute({ userId, cursor: decodeCursor(q.cursor), limit: q.limit }), presentFeedItem);
  }
}

@Controller('api/v1/follows')
export class FollowsController {
  constructor(
    @Inject(FollowUserUseCase) private readonly follow: FollowUserUseCase,
    @Inject(UnfollowUserUseCase) private readonly unfollow: UnfollowUserUseCase,
    @Inject(GetFollowSuggestionsUseCase) private readonly suggestions: GetFollowSuggestionsUseCase,
  ) {}

  /** Declared before `:userId` so `suggestions` is never parsed as a user id. */
  @Get('suggestions')
  async getSuggestions(@CurrentUser('sub') userId: string, @Query(new ZodValidationPipe(suggestionsQuery)) q: In<typeof suggestionsQuery>) {
    await this.suggestions.execute({ userId, limit: q.limit });
    return { items: [], nextCursor: null };
  }

  @Put(':userId')
  @HttpCode(200)
  async followUser(@CurrentUser('sub') followerId: string, @Param('userId', id('userId')) followeeId: string) {
    return presentFollow(await this.follow.execute({ followerId, followeeId }));
  }

  @Delete(':userId')
  @HttpCode(204)
  async unfollowUser(@CurrentUser('sub') followerId: string, @Param('userId', id('userId')) followeeId: string): Promise<void> {
    await this.unfollow.execute({ followerId, followeeId });
  }
}

@Controller('api/v1/groups')
export class GroupsController {
  constructor(
    @Inject(CreateGroupUseCase) private readonly create: CreateGroupUseCase,
    @Inject(SearchGroupsUseCase) private readonly search: SearchGroupsUseCase,
    @Inject(GetGroupUseCase) private readonly get: GetGroupUseCase,
    @Inject(JoinGroupUseCase) private readonly joinGroup: JoinGroupUseCase,
    @Inject(ListGroupMembersUseCase) private readonly members: ListGroupMembersUseCase,
    @Inject(ReviewGroupMemberUseCase) private readonly review: ReviewGroupMemberUseCase,
    @Inject(LeaveGroupUseCase) private readonly leaveGroup: LeaveGroupUseCase,
    @Inject(ListGroupPostsUseCase) private readonly groupPosts: ListGroupPostsUseCase,
  ) {}

  @Post()
  @Idempotent()
  async createGroup(@CurrentUser('sub') ownerId: string, @Body(new ZodValidationPipe(createGroupBody)) body: In<typeof createGroupBody>) {
    return presentGroup(await this.create.execute({ ownerId, ...body }));
  }

  @Get()
  async list(@CurrentUser('sub') userId: string, @Query(new ZodValidationPipe(listGroupsQuery)) q: In<typeof listGroupsQuery>) {
    return page(await this.search.execute({ userId, ...(q.query ? { query: q.query } : {}), cursor: decodeCursor(q.cursor), limit: q.limit }), presentGroup);
  }

  @Get(':groupId')
  async getGroup(@CurrentUser('sub') userId: string, @Param('groupId', id('groupId')) groupId: string) {
    return presentGroup(await this.get.execute({ groupId, userId }));
  }

  @Post(':groupId/join')
  @HttpCode(200)
  async join(@CurrentUser('sub') userId: string, @Param('groupId', id('groupId')) groupId: string) {
    return presentMembership(await this.joinGroup.execute({ groupId, userId }));
  }

  @Get(':groupId/members')
  async listMembers(@CurrentUser('sub') userId: string, @Param('groupId', id('groupId')) groupId: string, @Query(new ZodValidationPipe(listMembersQuery)) q: In<typeof listMembersQuery>) {
    return page(await this.members.execute({ groupId, userId, ...(q.status ? { status: q.status } : {}), cursor: decodeCursor(q.cursor), limit: q.limit }), presentMembershipOutput);
  }

  @Post(':groupId/members/:userId/approve')
  @HttpCode(200)
  async approve(@CurrentUser('sub') actorId: string, @Param('groupId', id('groupId')) groupId: string, @Param('userId', id('userId')) targetUserId: string) {
    return presentMembership(await this.review.execute({ groupId, actorId, targetUserId, decision: 'approve' }));
  }

  @Post(':groupId/members/:userId/reject')
  @HttpCode(200)
  async reject(@CurrentUser('sub') actorId: string, @Param('groupId', id('groupId')) groupId: string, @Param('userId', id('userId')) targetUserId: string) {
    return presentMembership(await this.review.execute({ groupId, actorId, targetUserId, decision: 'reject' }));
  }

  @Post(':groupId/leave')
  @HttpCode(200)
  async leave(@CurrentUser('sub') userId: string, @Param('groupId', id('groupId')) groupId: string) {
    return presentMembership(await this.leaveGroup.execute({ groupId, userId }));
  }

  @Get(':groupId/posts')
  async posts(@CurrentUser('sub') viewerId: string, @Param('groupId', id('groupId')) groupId: string, @Query(new ZodValidationPipe(pageQuery)) q: In<typeof pageQuery>) {
    return page(await this.groupPosts.execute({ groupId, viewerId, cursor: decodeCursor(q.cursor), limit: q.limit }), presentPost);
  }
}

@Controller('api/v1/reports')
export class ReportsController {
  constructor(@Inject(ReportContentUseCase) private readonly report: ReportContentUseCase) {}

  @Post()
  @Idempotent()
  async create(@CurrentUser('sub') reporterId: string, @Body(new ZodValidationPipe(reportBody)) body: In<typeof reportBody>) {
    return presentReport(await this.report.execute({ reporterId, ...body }));
  }
}

